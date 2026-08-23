import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockId,
  EffectJournal,
  ProjectionCompiler,
  SurfaceId,
  WorkSurfaceStore,
} from '@pf-worksurface/core'
import type { SurfaceSessionBinding } from '@pf-worksurface/core'
import { runAgent } from '../src/agent-run.ts'
import type { AgentRunHost, AgentRunRequest } from '../src/agent-run.ts'
import type { AgentCompletion, AttemptAuthority, WorkSurfaceProfile } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('durable Agent delegation recovery', () => {
  test('fails loud when continuation is unavailable and never creates a one-shot binding', async () => {
    const fixture = await recoveryFixture()
    fixture.host.startContinuable = async () => {
      throw Object.assign(new Error('continuation service unavailable'), { code: 'CONTINUATION_UNAVAILABLE' })
    }

    await expect(runAgent(fixture.host, fixture.attempt, fixture.request)).rejects.toBeDefined()
    await expect(fixture.store.readSessionBinding({ surface: fixture.request.surface })).resolves.toBeUndefined()
    await expect(fixture.store.readHead(fixture.request.surface)).resolves.toBeDefined()
  })

  test('keeps file-first Surface creation recoverable after child start fails', async () => {
    const fixture = await recoveryFixture()
    let starts = 0
    fixture.host.startContinuable = async () => {
      starts += 1
      if (starts === 1) throw new Error('injected start failure')
      return 'session-recovered'
    }
    fixture.host.waitForCompletion = sessionId => completeDelegation(fixture.store, sessionId, fixture.root, 'recovered')

    await expect(runAgent(fixture.host, fixture.attempt, fixture.request)).rejects.toMatchObject({ code: 'effect-failed' })
    await expect(fixture.store.readHead(fixture.request.surface)).resolves.toBeDefined()
    await expect(fixture.store.readSessionBinding({ surface: fixture.request.surface })).resolves.toBeUndefined()

    const completion = await runAgent(fixture.host, fixture.attempt, { ...fixture.request, retry: true })
    expect(completion.summary).toBe('recovered')
    expect(starts).toBe(2)
    expect((await fixture.store.readSessionBinding({ surface: fixture.request.surface }))?.sessionId).toBe('session-recovered')
  })

  test('resumes the Session already bound to an incomplete Surface', async () => {
    const fixture = await recoveryFixture()
    await fixture.store.newSurface({
      attemptId: 'bootstrap',
      key: 'child',
      templatePath: fixture.request.templatePath as string,
      surface: fixture.request.surface,
      parent: 'ws-root',
    })
    const projection = await fixture.host.projections.compile({
      surface: fixture.request.surface,
      profile: PROFILE.name,
      tokenBudget: PROFILE.tokenBudget,
    })
    await fixture.store.bindSession({
      surface: fixture.request.surface,
      sessionId: 'session-existing',
      role: 'delegated',
      execution: 'continuable',
      rootSurface: fixture.attempt.rootSurface,
      parentSessionId: String(fixture.attempt.parent.id),
      input: {
        surfaceRevision: projection.surfaceRevision,
        blockRevisions: projection.blockRevisions,
        omittedBlockRevisions: [],
        profile: PROFILE.name,
        task: fixture.request.task,
      },
    })
    let resumed = ''
    fixture.host.resumeContinuable = async (_parent, binding) => { resumed = binding.sessionId }
    fixture.host.startContinuable = async () => { throw new Error('must not start a replacement Session') }
    fixture.host.waitForCompletion = sessionId => completeDelegation(fixture.store, sessionId, fixture.root, 'resumed')

    const completion = await runAgent(fixture.host, fixture.attempt, fixture.request)
    expect(completion.summary).toBe('resumed')
    expect(resumed).toBe('session-existing')
    expect((await fixture.store.readSessionBinding({ surface: fixture.request.surface }))?.sessionId).toBe('session-existing')
  })

  test('recovers a completed result from canonical binding without an attempt result file', async () => {
    const fixture = await recoveryFixture()
    let starts = 0
    fixture.host.startContinuable = async () => { starts += 1; return 'session-complete' }
    fixture.host.waitForCompletion = sessionId => completeDelegation(fixture.store, sessionId, fixture.root, 'canonical')
    const first = await runAgent(fixture.host, fixture.attempt, fixture.request)

    const nextAttempt = await makeAttempt(fixture.root, fixture.attempt.parent, 'attempt-restarted')
    const nextJournal = new EffectJournal(join(fixture.root, 'effects-restarted'))
    const nextHost = { ...fixture.host, agentJournal: nextJournal }
    nextHost.startContinuable = async () => { throw new Error('canonical completion must prevent a second child') }
    nextHost.waitForCompletion = async () => { throw new Error('canonical completion must return immediately') }
    const recovered = await runAgent(nextHost, nextAttempt, fixture.request)

    expect(recovered).toEqual(first)
    expect(starts).toBe(1)
  })

  test('never hides a corrupt canonical binding behind an attempt-local result cache', async () => {
    const fixture = await recoveryFixture()
    fixture.host.startContinuable = async () => 'session-complete'
    fixture.host.waitForCompletion = sessionId => completeDelegation(fixture.store, sessionId, fixture.root, 'canonical')
    await runAgent(fixture.host, fixture.attempt, fixture.request)

    const bindingPath = join(
      fixture.store.canonicalRoot, 'surfaces', fixture.request.surface, 'binding.json',
    )
    const binding = JSON.parse(await readFile(bindingPath, 'utf8'))
    await writeFile(bindingPath, JSON.stringify({ ...binding, version: 99 }))
    const replayHost = {
      ...fixture.host,
      agentJournal: new EffectJournal(join(fixture.root, 'effects-corrupt-replay')),
    }

    await expect(runAgent(replayHost, fixture.attempt, fixture.request)).rejects.toMatchObject({
      code: 'canonical-corrupt',
    })
  })

  test('preserves and rejects an incomplete legacy binding instead of guessing continuation semantics', async () => {
    const fixture = await recoveryFixture()
    await fixture.store.newSurface({
      attemptId: 'bootstrap', key: 'legacy', templatePath: fixture.request.templatePath as string,
      surface: fixture.request.surface, parent: 'ws-root',
    })
    const childHead = await fixture.store.readHead(fixture.request.surface)
    const bindingPath = join(
      fixture.store.canonicalRoot, 'surfaces', fixture.request.surface, 'binding.json',
    )
    const now = new Date().toISOString()
    await writeFile(bindingPath, JSON.stringify({
      surface: fixture.request.surface,
      sessionId: 'legacy-child',
      role: 'delegated',
      rootSurface: fixture.attempt.rootSurface,
      parentSessionId: String(fixture.attempt.parent.id),
      input: {
        surfaceRevision: childHead.revision,
        blockRevisions: [],
        omittedBlockRevisions: [],
        profile: PROFILE.name,
      },
      createdAt: now,
      updatedAt: now,
    }))
    let resumed = false
    fixture.host.resumeContinuable = async () => { resumed = true }

    await expect(runAgent(fixture.host, fixture.attempt, fixture.request)).rejects.toMatchObject({
      code: 'session-binding-conflict',
    })
    expect(resumed).toBe(false)
    await expect(readFile(bindingPath, 'utf8')).resolves.toContain('legacy-child')
  })
})

const PROFILE: WorkSurfaceProfile = {
  name: 'test',
  provider: 'fixture',
  tokenBudget: 10_000,
  maxDepth: 3,
  maxParallel: 1,
}

async function recoveryFixture(): Promise<{
  root: string
  store: WorkSurfaceStore
  attempt: AttemptAuthority
  host: MutableHost
  request: AgentRunRequest
}> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-agent-recovery-'))
  roots.push(root)
  const rootTemplate = join(root, 'root-template')
  const childTemplate = join(root, 'child-template')
  await writeTemplate(rootTemplate, 'ws-root')
  await writeTemplate(childTemplate, 'ws-child')
  const store = new WorkSurfaceStore({ root: join(root, 'store') })
  await store.newSurface({ attemptId: 'bootstrap', key: 'root', templatePath: rootTemplate, surface: 'ws-root' })
  const parent = { id: 'parent-session', session: { header: { id: 'parent-session' } } } as unknown as Agent
  const attempt = await makeAttempt(root, parent, 'attempt-initial')
  const host: MutableHost = {
    ctx: new Context(),
    store,
    projections: new ProjectionCompiler(store),
    agentJournal: new EffectJournal(join(root, 'effects')),
    profile: () => PROFILE,
    startContinuable: async () => 'session-default',
    resumeContinuable: async () => {},
    bindingCommitted: () => {},
    bindingFailed: () => {},
    waitForCompletion: async () => { throw new Error('fixture completion is not configured') },
  }
  return {
    root,
    store,
    attempt,
    host,
    request: {
      surface: SurfaceId('ws-child'),
      task: 'durable task',
      profile: PROFILE.name,
      key: 'delegate-child',
      templatePath: childTemplate,
      parent: 'ws-root',
      retry: false,
      signal: new AbortController().signal,
    },
  }
}

type MutableHost = AgentRunHost & {
  startContinuable: AgentRunHost['startContinuable']
  resumeContinuable: AgentRunHost['resumeContinuable']
  waitForCompletion: AgentRunHost['waitForCompletion']
}

async function makeAttempt(root: string, parent: Agent, id: string): Promise<AttemptAuthority> {
  const attemptRoot = join(root, id)
  const workspaceRoot = join(attemptRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  return {
    id,
    token: `token-${id}`,
    rootSurface: SurfaceId('ws-root'),
    root: attemptRoot,
    workspaceRoot,
    workspaceSurface: SurfaceId('ws-root'),
    rootWorkingPath: join(workspaceRoot, 'work', 'root'),
    rootBaseRevision: `sha256:${'0'.repeat(64)}` as never,
    workspaceHash: `workspace-${id}`,
    parent,
    surfaces: new Set([SurfaceId('ws-root')]),
    childCredentials: new Map(),
    operations: new Set(),
    activeAgents: 0,
  }
}

async function completeDelegation(
  store: WorkSurfaceStore,
  sessionId: string,
  root: string,
  summary: string,
): Promise<AgentCompletion> {
  const binding = await requiredBinding(store, sessionId)
  const checkout = join(root, `completion-${summary}`)
  await store.checkout({ surface: binding.surface, targetPath: checkout, revision: binding.input?.surfaceRevision })
  const blockPath = join(checkout, 'blocks', 'result.md')
  await writeFile(blockPath, `${await readFile(blockPath, 'utf8')}\n${summary}\n`)
  const committed = await store.commit({
    attemptId: `child-${summary}`,
    key: `commit-${summary}`,
    workingPath: checkout,
    baseRevision: binding.input?.surfaceRevision as never,
  })
  const completion: AgentCompletion = {
    surface: binding.surface,
    surfaceRevision: committed.revision,
    summary,
    outputs: [{ surface: binding.surface, block: BlockId('result'), revision: committed.revision }],
  }
  await store.completeSessionBinding(binding.surface, sessionId, completion)
  return completion
}

async function requiredBinding(store: WorkSurfaceStore, sessionId: string): Promise<SurfaceSessionBinding> {
  const binding = await store.readSessionBinding({ sessionId })
  if (binding === undefined || binding.input === undefined) throw new Error(`missing binding for ${sessionId}`)
  return binding
}

async function writeTemplate(path: string, surface: string): Promise<void> {
  await mkdir(join(path, 'blocks'), { recursive: true })
  await writeFile(join(path, 'surface.md'), `# ${surface}\n\n[[block:${surface}/result]]\n`)
  await writeFile(join(path, 'blocks', 'result.md'), `---
block_id: result
surface_id: template
kind: result
status: active
derived_from: []
---
Initial.
`)
}
