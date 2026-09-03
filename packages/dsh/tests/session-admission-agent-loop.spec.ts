// Invariant assertions: [WS-01] [WS-09] [WS-10] [WS-13] [WS-20] [WS-21] [WS-27]
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FileEventStore, RevisionStore, SURFACE_TEMPLATE } from '@pf-worksurface/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDshSessionAdapter } from '../src/session-adapter.ts'
import { SurfaceSessionAdmission } from '../src/session-admission.ts'
import { SurfaceSessionService } from '../src/session-surface.ts'
import { WorkSurfaceService } from '../src/service.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 20,
}))))

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly replies: (string | Promise<string>)[]) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const pending = this.replies.shift()
    const text = await pending
    if (text === undefined) throw new Error('script exhausted')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function mountRuntime(root: string, surfaces: SurfaceSessionService, replies: (string | Promise<string>)[], persistenceRoot?: string) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(SystemPrompt, { persona: 'You are the test deployment.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock-model' })
  await ctx.plugin(ShellEnvPlugin, { dshHome: join(root, 'dsh-home') })
  if (persistenceRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  ctx.provide('workspaceRegistry', testWorkspaceRegistry() as never)
  const adapter = new ScriptedAdapter(replies)
  ctx.llm.registerAdapter(['mock'], adapter)
  installDshSessionAdapter(ctx, surfaces, join(root, 'unused.sock'))
  const admission = new SurfaceSessionAdmission(ctx, surfaces, () => Promise.resolve())
  return { admission, adapter, ctx }
}

async function mountServiceRuntime(root: string, work: string, replies: string[], persistenceRoot: string) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(SystemPrompt, { persona: 'You are the service restart test deployment.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock-model' })
  await ctx.plugin(ShellEnvPlugin, { dshHome: join(root, 'dsh-home') })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  ctx.provide('workspaceRegistry', testWorkspaceRegistry() as never)
  ctx.provide('subprocess', {} as never)
  ctx.provide('sandbox', {} as never)
  const adapter = new ScriptedAdapter(replies)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(WorkSurfaceService, {
    root: join(root, 'worksurface-state'),
    workRoot: work,
    socketPath: join(root, 'worksurface.sock'),
  })
  return { adapter, ctx }
}

function testWorkspaceRegistry() {
  return { create: () => Promise.resolve({ id: 'workspace-surfaces', attachSession: () => Promise.resolve() }) }
}

async function fixture(options: { persistence?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ws-real-agent-loop-')); roots.push(root)
  const work = join(root, 'work'); const state = join(root, 'state')
  await mkdir(join(work, 'surfaces', 'surface-a'), { recursive: true })
  await writeFile(join(work, 'surfaces', 'surface-a', 'surface.md'), SURFACE_TEMPLATE)

  const events = new FileEventStore(join(state, 'events'))
  const revisions = new RevisionStore(join(state, 'revisions'))
  await Promise.all([events.init(), revisions.init()])
  const surfaces = new SurfaceSessionService(events, revisions, work, state)
  await surfaces.init()
  const persistenceRoot = options.persistence === true ? join(root, 'sessions') : undefined
  const runtime = await mountRuntime(root, surfaces, ['first turn', 'second turn'], persistenceRoot)
  return { ...runtime, persistenceRoot, root, state, surfaces, work }
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('SurfaceSessionAdmission with the real DSH Agent Loop', () => {
  // Model-readiness evidence: [MR-GLOBAL-ASSEMBLY-AND-ROOT-L1] [MR-FIRST-SURFACE-DISCOVERY-L2]
  it('exposes WorkSurface discovery and the public authoring root to an ordinary Agent before any Surface exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-global-discovery-')); roots.push(root)
    const work = join(root, 'work')
    const runtime = await mountServiceRuntime(root, work, [], join(root, 'sessions'))
    try {
      const assembly = await runtime.ctx.systemPrompt.assemble()
      const prompt = assembly.sections.map(section => section.text).join('\n')
      const guidance = assembly.sections.find(section => section.name === 'worksurface:guidance')?.text ?? ''
      expect(guidance.length).toBeLessThanOrEqual(1_200)
      expect(prompt).toContain('WorkSurface is an available capability for durable, independently assessable work')
      expect(prompt).toContain('Author it in ordinary files')
      expect(prompt).toContain('Orchestrate coordinates existing Surfaces only')
      expect(prompt).toContain('`"$DSH_WORKSURFACE_CLI" help author`')

      const ordinary = await runtime.ctx.agents.create({
        sessionId: SessionId('ordinary-session'),
        meta: { cwd: root },
        agentOptions: { provider: 'mock', model: 'mock-model' },
        setup: () => Promise.resolve(),
      })
      const environment = runtime.ctx.shellEnv.collect({ agent: ordinary.agent } as never)
      expect(environment.DSH_WORKSURFACE_CLI).toMatch(/packages[\\/]cli[\\/]lib[\\/]bin\.js$/)
      expect(environment.DSH_WORKSURFACE_ROOT).toBe(work)
      expect(environment.DSH_SURFACE_ID).toBeUndefined()
      expect(environment.DSH_SURFACE_DIR).toBeUndefined()
      expect(environment.DSH_WORKSURFACE_VIEW_DIR).toBeUndefined()
      expect(await runtime.ctx.workSurfaces.listSurfaces()).toEqual([])

      const first = join(environment.DSH_WORKSURFACE_ROOT!, 'surfaces', 'first-surface')
      await mkdir(first, { recursive: true })
      await writeFile(join(first, 'surface.md'), SURFACE_TEMPLATE.replace('# Goal\n', '# Goal\n\nProve first-Surface bootstrap.\n'))
      expect(await runtime.ctx.workSurfaces.listSurfaces()).toEqual([
        { surfaceId: 'first-surface', title: 'Prove first-Surface bootstrap.' },
      ])
    } finally {
      await runtime.ctx.fiber.dispose()
    }
  })

  it('isolates one broken authoring Orchestration while admitting the remaining valid Registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-authoring-isolation-')); roots.push(root)
    const work = join(root, 'work')
    await mkdir(join(work, 'surfaces', 'surface-a'), { recursive: true })
    await writeFile(join(work, 'surfaces', 'surface-a', 'surface.md'), SURFACE_TEMPLATE)

    const broken = join(work, 'orchestrations', 'a-broken')
    await mkdir(join(broken, 'artifact'), { recursive: true })
    await writeFile(join(broken, 'registration.json'), JSON.stringify({
      version: 1,
      registrationId: 'broken',
      entrypoint: 'orchestrate.py',
      bindings: { subject: 'surface-a' },
      events: { 'broken.ready': { builtin: true, consumeFrom: ['subject'] } },
    }))

    const valid = join(work, 'orchestrations', 'b-valid')
    await mkdir(valid, { recursive: true })
    await writeFile(join(valid, 'definition.json'), JSON.stringify({
      version: 1,
      roles: ['subject'],
      subscriptions: [{
        id: 'never',
        history: 'all',
        when: { role: 'subject', event: 'never.requested' },
        reaction: { emit: [{ role: 'subject', event: 'never.completed', payload: {}, operationKey: 'never' }] },
      }],
    }))
    await writeFile(join(valid, 'registration.json'), JSON.stringify({
      version: 1,
      registrationId: 'valid',
      bindings: { subject: 'surface-a' },
    }))

    const runtime = await mountServiceRuntime(root, work, [], join(root, 'sessions'))
    try {
      expect(await runtime.ctx.workSurfaces.inspectOrchestration('valid')).toMatchObject({
        orchestrationId: 'b-valid',
        registrationId: 'valid',
        bindings: { subject: 'surface-a' },
      })
      const opened = await runtime.ctx.workSurfaces.ensureSession({ surfaceId: 'surface-a' })
      const agent = runtime.ctx.agents.get(SessionId(opened.sessionId))!
      agent.session.append('turn/start', { turn: 1 })
      const capability = runtime.ctx.workSurfaces.surfaces.activeTurn(opened.sessionId)!.capability
      await expect(runtime.ctx.workSurfaces.emitTurn(capability, 'valid.progress', {}, 'valid-progress'))
        .resolves.toMatchObject({ subject: 'surface:surface-a', seq: 0 })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    } finally {
      await runtime.ctx.fiber.dispose()
    }
  })

  it('durably receipts a managed followup at Turn admission without waiting for model completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-followup-receipt-')); roots.push(root)
    const work = join(root, 'work'); const state = join(root, 'state')
    await mkdir(join(work, 'surfaces', 'surface-a'), { recursive: true })
    await writeFile(join(work, 'surfaces', 'surface-a', 'surface.md'), SURFACE_TEMPLATE)
    const events = new FileEventStore(join(state, 'events')); const revisions = new RevisionStore(join(state, 'revisions'))
    await Promise.all([events.init(), revisions.init()])
    const surfaces = new SurfaceSessionService(events, revisions, work, state); await surfaces.init()
    let release!: (value: string) => void
    const gated = new Promise<string>(resolve => { release = resolve })
    const runtime = await mountRuntime(root, surfaces, [gated], join(root, 'sessions'))
    try {
      await runtime.admission.ensure({ surfaceId: 'surface-a' })
      const receipt = await Promise.race([
        surfaces.followupSurface('surface-a', 'managed work', 'managed-message'),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('followup waited for model completion')), 1_000)),
      ])
      expect(receipt).toMatchObject({ messageId: 'managed-message', turnId: '1' })
      const agent = runtime.ctx.agents.get(SessionId(receipt.sessionId))!
      expect(agent.session.events.some(event => event.type === 'turn/end')).toBe(false)
      release('completed')
      await agent.whenIdle()
    } finally {
      release('completed')
      await runtime.ctx.fiber.dispose()
    }
  })

  it('opens blank, then runs two ordinary Turns in one Session and one persistent cwd', async () => {
    const { admission, adapter, ctx, surfaces } = await fixture()
    try {
      const opened = await admission.ensure({ surfaceId: 'surface-a' })
      const agent = ctx.agents.get(SessionId(opened.sessionId))!
      expect(agent.session.events.some(event => event.type === 'worksurface/binding')).toBe(false)
      expect(agent.session.events.some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)

      send(agent, 'start from the contract')
      await agent.whenIdle()
      const eventTypes = agent.session.events.map(event => event.type)
      expect(eventTypes).not.toContain('worksurface/binding')
      expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(agent.session.header.cwd).toBe(surfaces.cwdForSurface('surface-a'))
      const turnPrompt = adapter.requests[0]?.messages
        .flatMap(message => message.content)
        .map(block => block.type === 'text' ? block.text : '')
        .join('\n') ?? ''
      expect(turnPrompt).toContain('complete progress history of WorkSurface')
      expect(turnPrompt).toContain('Current WorkSurface adapter locators for DSH Turn')
      expect(turnPrompt).toContain(surfaces.cwdForSurface('surface-a'))

      const wip = join(agent.session.header.cwd!, 'wip.txt')
      await writeFile(wip, 'same authoring WIP\n')
      expect((await admission.ensure({ surfaceId: 'surface-a' })).sessionId).toBe(opened.sessionId)
      send(agent, 'continue the same work')
      await agent.whenIdle()

      expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
      expect(await readFile(wip, 'utf8')).toBe('same authoring WIP\n')
      expect(surfaces.bindingForSurface('surface-a')?.sessionId).toBe(opened.sessionId)
      expect(surfaces.activeSurface(opened.sessionId)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('automatically continues a crash-interrupted Turn in the same Session and authoring WIP after restart', async () => {
    const first = await fixture({ persistence: true })
    const opened = await first.admission.ensure({ surfaceId: 'surface-a' })
    const firstAgent = first.ctx.agents.get(SessionId(opened.sessionId))!
    send(firstAgent, 'first process')
    await firstAgent.whenIdle()
    await writeFile(join(firstAgent.session.header.cwd!, 'restart-wip.txt'), 'survives restart\n')
    // Model the last durable boundary of a process that died during Turn 2.
    // Persistence will synthesize its interrupted closer during cold inspect.
    firstAgent.session.append('turn/start', { turn: 2 })
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    const events = new FileEventStore(join(first.state, 'events'))
    const revisions = new RevisionStore(join(first.state, 'revisions'))
    await Promise.all([events.init(), revisions.init()])
    const recoveredSurfaces = new SurfaceSessionService(events, revisions, first.work, first.state)
    await recoveredSurfaces.init()
    const second = await mountRuntime(first.root, recoveredSurfaces, ['after restart'], first.persistenceRoot)
    try {
      const recovery = await second.admission.recoverAfterRestart()
      const resumed = second.ctx.agents.get(SessionId(opened.sessionId))!
      await resumed.whenIdle()
      expect(recovery).toEqual([{ surfaceId: 'surface-a', sessionId: opened.sessionId, cause: 'interrupted' }])
      expect(resumed.session.events.filter(event => event.type === 'worksurface/binding')).toHaveLength(0)
      expect(resumed.session.events.filter(event => event.type === 'turn/start')).toHaveLength(3)
      expect(resumed.session.events.filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' && event.data.reason.kind))
        .toEqual(['completed', 'interrupted', 'completed'])
      expect(resumed.session.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@pf-worksurface/dsh')).toBe(true)
      expect(resumed.session.header.cwd).toBe(firstAgent.session.header.cwd)
      expect(await readFile(join(resumed.session.header.cwd!, 'restart-wip.txt'), 'utf8')).toBe('survives restart\n')
      expect(recoveredSurfaces.bindingForSurface('surface-a')?.sessionId).toBe(opened.sessionId)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('does not auto-resume a completed idle Surface Session after restart', async () => {
    const first = await fixture({ persistence: true })
    const opened = await first.admission.ensure({ surfaceId: 'surface-a' })
    const firstAgent = first.ctx.agents.get(SessionId(opened.sessionId))!
    send(firstAgent, 'completed before restart')
    await firstAgent.whenIdle()
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    const events = new FileEventStore(join(first.state, 'events'))
    const revisions = new RevisionStore(join(first.state, 'revisions'))
    await Promise.all([events.init(), revisions.init()])
    const recoveredSurfaces = new SurfaceSessionService(events, revisions, first.work, first.state)
    await recoveredSurfaces.init()
    const second = await mountRuntime(first.root, recoveredSurfaces, ['must stay unused'], first.persistenceRoot)
    try {
      expect(await second.admission.recoverAfterRestart()).toEqual([])
      expect(second.ctx.agents.get(SessionId(opened.sessionId))).toBeUndefined()
      expect(second.adapter.requests).toEqual([])
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('continues a Turn closed as disposed by a graceful DSH restart', async () => {
    const first = await fixture({ persistence: true })
    const opened = await first.admission.ensure({ surfaceId: 'surface-a' })
    const firstAgent = first.ctx.agents.get(SessionId(opened.sessionId))!
    send(firstAgent, 'first process')
    await firstAgent.whenIdle()
    firstAgent.session.append('turn/start', { turn: 2 })
    firstAgent.session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    const events = new FileEventStore(join(first.state, 'events'))
    const revisions = new RevisionStore(join(first.state, 'revisions'))
    await Promise.all([events.init(), revisions.init()])
    const recoveredSurfaces = new SurfaceSessionService(events, revisions, first.work, first.state)
    await recoveredSurfaces.init()
    const second = await mountRuntime(first.root, recoveredSurfaces, ['continued after graceful restart'], first.persistenceRoot)
    try {
      expect(await second.admission.recoverAfterRestart())
        .toEqual([{ surfaceId: 'surface-a', sessionId: opened.sessionId, cause: 'disposed' }])
      const resumed = second.ctx.agents.get(SessionId(opened.sessionId))!
      await resumed.whenIdle()
      expect(resumed.session.events.filter(event => event.type === 'turn/start')).toHaveLength(3)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('wakes a durable queued followup that had not opened its Turn before restart', async () => {
    const first = await fixture({ persistence: true })
    const opened = await first.admission.ensure({ surfaceId: 'surface-a' })
    const firstAgent = first.ctx.agents.get(SessionId(opened.sessionId))!
    const queued = createUserMessage({ content: [{ type: 'text', text: 'queued before restart' }], source: { kind: 'user' } })
    firstAgent.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [queued],
    })
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    const events = new FileEventStore(join(first.state, 'events'))
    const revisions = new RevisionStore(join(first.state, 'revisions'))
    await Promise.all([events.init(), revisions.init()])
    const recoveredSurfaces = new SurfaceSessionService(events, revisions, first.work, first.state)
    await recoveredSurfaces.init()
    const second = await mountRuntime(first.root, recoveredSurfaces, ['continued queued followup'], first.persistenceRoot)
    try {
      expect(await second.admission.recoverAfterRestart())
        .toEqual([{ surfaceId: 'surface-a', sessionId: opened.sessionId, cause: 'queued-followup' }])
      const resumed = second.ctx.agents.get(SessionId(opened.sessionId))!
      await resumed.whenIdle()
      expect(resumed.session.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text === 'queued before restart'))).toBe(true)
      expect(resumed.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('lets an Agent plan Surfaces and admits a dependent target only after its exact event condition matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-agent-plan-')); roots.push(root)
    const work = join(root, 'work')
    const persistenceRoot = join(root, 'sessions')
    await mkdir(join(work, 'surfaces', 'planner'), { recursive: true })
    await writeFile(join(work, 'surfaces', 'planner', 'surface.md'), SURFACE_TEMPLATE)
    const runtime = await mountServiceRuntime(root, work, ['root child ran', 'dependent child ran'], persistenceRoot)
    try {
      const opened = await runtime.ctx.workSurfaces.ensureSession({ surfaceId: 'planner' })
      const planner = runtime.ctx.agents.get(SessionId(opened.sessionId))!
      planner.session.append('turn/start', { turn: 1 })
      const capability = runtime.ctx.workSurfaces.surfaces.activeTurn(opened.sessionId)!.capability
      const contract = SURFACE_TEMPLATE
        .replace('# Goal\n', '# Goal\n\nProduce the dependent deliverable.\n')
        .replace('# Known Facts and Constraints\n', '# Known Facts and Constraints\n\nEmit `delivery.completed` with stable key `delivery-v1`.\n')
      for (const surfaceId of ['root-child', 'dependent-child']) {
        await mkdir(join(work, 'surfaces', surfaceId), { recursive: true })
        await writeFile(join(work, 'surfaces', surfaceId, 'surface.md'), contract)
        await writeFile(join(work, 'surfaces', surfaceId, 'evidence.txt'), 'file-authored before emit\n')
      }
      const invalidPlan = join(work, 'orchestrations', 'invalid-plan')
      const externalRegistration = join(root, 'external-registration.json')
      await mkdir(invalidPlan, { recursive: true })
      await writeFile(externalRegistration, JSON.stringify({ version: 1, registrationId: 'outside', bindings: { root: 'root-child' } }))
      await symlink(externalRegistration, join(invalidPlan, 'registration.json'))
      await expect(runtime.ctx.workSurfaces.emitTurn(capability, 'root.symlink', {}, 'symlink')).rejects.toMatchObject({ code: 'invalid-definition' })
      expect(await runtime.ctx.workSurfaces.replayEvents('planner')).toEqual([])
      await rm(invalidPlan, { recursive: true })
      await mkdir(invalidPlan, { recursive: true })
      await writeFile(join(invalidPlan, 'registration.json'), JSON.stringify({ version: 1, registrationId: 'invalid', bindings: {}, command: 'register' }))
      await expect(runtime.ctx.workSurfaces.emitTurn(capability, 'root.invalid', {}, 'invalid')).rejects.toMatchObject({ code: 'invalid-definition' })
      expect(await runtime.ctx.workSurfaces.replayEvents('planner')).toEqual([])
      await rm(invalidPlan, { recursive: true })

      const definition = {
        version: 1 as const,
        roles: ['sourceA', 'sourceB', 'root', 'child'],
        subscriptions: [{
          id: 'start-root', history: 'from-registration' as const,
          when: { role: 'sourceA', event: 'root.a.ready' },
          reaction: { followup: [{ role: 'root', message: 'Execute the dependency-free root contract.', operationKey: 'start-root' }] },
        }, {
          id: 'join-roots', history: 'all' as const, key: '$.payload.plan',
          when: { all: [{ role: 'sourceA', event: 'root.a.ready' }, { role: 'sourceB', event: 'root.b.ready' }] },
          reaction: { followup: [{ role: 'child', message: 'Read surface.md and execute the dependent deliverable.', operationKey: 'start-dependent' }] },
        }],
      }
      const bindings = { sourceA: 'planner', sourceB: 'planner', root: 'root-child', child: 'dependent-child' }
      await mkdir(join(work, 'orchestrations', 'dependent-plan', 'handlers'), { recursive: true })
      await writeFile(join(work, 'orchestrations', 'dependent-plan', 'definition.json'), JSON.stringify(definition))
      await writeFile(join(work, 'orchestrations', 'dependent-plan', 'handlers', 'support.mjs'), 'export const support = true\n', { mode: 0o755 })
      await writeFile(join(work, 'orchestrations', 'dependent-plan', 'registration.json'), JSON.stringify({
        version: 1, registrationId: 'reg-dependent-plan', bindings,
      }))

      await runtime.ctx.workSurfaces.emitTurn(capability, 'root.a.ready', { plan: 'p1' }, 'root-a')
      const registeredInspection = await runtime.ctx.workSurfaces.inspectOrchestration('reg-dependent-plan')
      expect(registeredInspection.bindings).toEqual(bindings)
      expect((await runtime.ctx.workSurfaces.readRevisionFile(registeredInspection.definitionRevision, 'handlers/support.mjs')).content)
        .toBe('export const support = true\n')
      await expect(runtime.ctx.workSurfaces.readRevisionFile(registeredInspection.definitionRevision, 'registration.json'))
        .rejects.toMatchObject({ code: 'not-found' })
      await vi.waitFor(() => expect(runtime.ctx.workSurfaces.surfaces.bindingForSurface('root-child')).toBeDefined())
      const rootBinding = runtime.ctx.workSurfaces.surfaces.bindingForSurface('root-child')!
      await vi.waitFor(() => expect(runtime.ctx.agents.get(SessionId(rootBinding.sessionId))).toBeDefined())
      await runtime.ctx.agents.get(SessionId(rootBinding.sessionId))!.whenIdle()
      expect(runtime.ctx.workSurfaces.surfaces.bindingForSurface('dependent-child')).toBeUndefined()
      await writeFile(join(work, 'surfaces', 'root-child', 'surface.md'), 'temporarily invalid while in progress\n')

      await runtime.ctx.workSurfaces.emitTurn(capability, 'root.b.ready', { plan: 'p1' }, 'root-b')
      await vi.waitFor(() => expect(runtime.ctx.workSurfaces.surfaces.bindingForSurface('dependent-child')).toBeDefined())
      const childBinding = runtime.ctx.workSurfaces.surfaces.bindingForSurface('dependent-child')!
      await vi.waitFor(() => expect(runtime.ctx.agents.get(SessionId(childBinding.sessionId))).toBeDefined())
      const child = runtime.ctx.agents.get(SessionId(childBinding.sessionId))!
      await vi.waitFor(() => expect(child.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1))
      await child.whenIdle()
      expect(child.session.events.filter(event => event.type === 'worksurface/binding')).toHaveLength(0)
      expect(child.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(child.session.deriveMessages().some(message => message.content.some(block => block.type === 'text'
        && block.text === 'Read surface.md and execute the dependent deliverable.'))).toBe(true)
      await vi.waitFor(async () => expect((await runtime.ctx.workSurfaces.inspectOrchestration('reg-dependent-plan')).pendingOperations).toEqual([]))
      const inspection = await runtime.ctx.workSurfaces.inspectOrchestration('reg-dependent-plan')
      const target = inspection.runs[0]?.operations[0]?.target
      if (target === undefined || !('messageId' in target)) throw new Error('expected managed followup receipt')
      await runtime.ctx.workSurfaces.engine.reconcile('reg-dependent-plan')
      expect(child.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(runtime.ctx.agents.list().filter(agent => String(agent.id) === childBinding.sessionId)).toHaveLength(1)
      planner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    } finally {
      await runtime.ctx.fiber.dispose()
    }
  })

  it('automatically invokes restart recovery from WorkSurfaceService initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-service-restart-')); roots.push(root)
    const work = join(root, 'work')
    const persistenceRoot = join(root, 'sessions')
    await mkdir(join(work, 'surfaces', 'surface-a'), { recursive: true })
    await writeFile(join(work, 'surfaces', 'surface-a', 'surface.md'), SURFACE_TEMPLATE)

    const first = await mountServiceRuntime(root, work, ['first service turn'], persistenceRoot)
    const opened = await first.ctx.workSurfaces.ensureSession({ surfaceId: 'surface-a' })
    const firstAgent = first.ctx.agents.get(SessionId(opened.sessionId))!
    send(firstAgent, 'start before service restart')
    await firstAgent.whenIdle()
    expect(firstAgent.session.events.find(event => event.type === 'worksurface/context-revision')).toMatchObject({ ignorable: true })
    expect(firstAgent.session.events.find(event => event.type === 'context/rendered')).toMatchObject({ ignorable: true })
    expect(first.adapter.requests[0]?.messages.some(message => message.content.some(block => block.type === 'text'
      && block.text.includes('# Acceptance Criteria')))).toBe(true)
    await writeFile(join(firstAgent.session.header.cwd!, 'service-restart.txt'), 'same durable authoring WIP\n')
    firstAgent.session.append('turn/start', { turn: 2 })
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    // Mounting the complete service is the only recovery action in lifecycle 2.
    // WorkSurfaceService.init must inspect, resume, and wake the bound Session.
    const second = await mountServiceRuntime(root, work, ['automatic service continuation'], persistenceRoot)
    try {
      const resumed = second.ctx.agents.get(SessionId(opened.sessionId))!
      expect(resumed).toBeDefined()
      await resumed.whenIdle()
      expect(second.adapter.requests).toHaveLength(1)
      expect(resumed.session.events.filter(event => event.type === 'turn/start')).toHaveLength(3)
      expect(resumed.session.events.filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' && event.data.reason.kind))
        .toEqual(['completed', 'interrupted', 'completed'])
      expect(await readFile(join(resumed.session.header.cwd!, 'service-restart.txt'), 'utf8'))
        .toBe('same durable authoring WIP\n')
      expect(second.ctx.workSurfaces.surfaces.bindingForSurface('surface-a')?.sessionId).toBe(opened.sessionId)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })
})
