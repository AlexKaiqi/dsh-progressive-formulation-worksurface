// Invariant assertions: [WS-01] [WS-09] [WS-20]
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { FileEventStore, RevisionStore, SURFACE_TEMPLATE } from '@pf-worksurface/core'
import { afterEach, describe, expect, it } from 'vitest'
import { SurfaceSessionAdmission } from '../src/session-admission.ts'
import { SurfaceSessionService } from '../src/session-surface.ts'
import { WorkSurfaceService } from '../src/service.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

class FakeAgents {
  readonly live = new Map<string, Agent>()
  readonly stored = new Map<string, Session>()
  readonly order: string[] = []

  get(id: ReturnType<typeof SessionId>): Agent | undefined { return this.live.get(String(id)) }

  async create(options: {
    sessionId: ReturnType<typeof SessionId>
    meta: { cwd: string; agentPreset?: string }
    setup(agentCtx: Context): Promise<void>
  }): Promise<AgentHandle> {
    const session = Session.create(options.sessionId, undefined, {
      version: SESSION_FORMAT_VERSION,
      id: options.sessionId,
      createdAt: 0,
      ...options.meta,
    })
    const agent = { id: session.id, session, followup: () => {}, steer: () => {} } as unknown as Agent
    this.order.push('setup')
    await options.setup({ agent } as unknown as Context)
    this.order.push('publish')
    this.live.set(String(options.sessionId), agent)
    this.stored.set(String(options.sessionId), session)
    return { agent, dispose: () => Promise.resolve() }
  }

  async resume(options: {
    resumeSessionId: ReturnType<typeof SessionId>
    setup(agentCtx: Context): Promise<void>
  }): Promise<AgentHandle> {
    const stored = this.stored.get(String(options.resumeSessionId))
    if (stored === undefined) throw new Error('missing persisted Session')
    const session = Session.create(options.resumeSessionId, stored.events, stored.header)
    const agent = { id: session.id, session, followup: () => {}, steer: () => {} } as unknown as Agent
    this.order.push('resume-setup')
    await options.setup({ agent } as unknown as Context)
    this.order.push('resume-publish')
    this.live.set(String(options.resumeSessionId), agent)
    this.stored.set(String(options.resumeSessionId), session)
    return { agent, dispose: () => Promise.resolve() }
  }

  detach(sessionId: string): void { this.live.delete(sessionId) }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-session-admission-')); roots.push(root)
  const work = join(root, 'work'); const state = join(root, 'state')
  await mkdir(join(work, 'surfaces', 'surface-a'), { recursive: true })
  await writeFile(join(work, 'surfaces', 'surface-a', 'surface.md'), SURFACE_TEMPLATE)
  await mkdir(join(work, 'surfaces', 'surface-b'), { recursive: true })
  await writeFile(join(work, 'surfaces', 'surface-b', 'surface.md'), SURFACE_TEMPLATE)
  const events = new FileEventStore(join(state, 'events'))
  const revisions = new RevisionStore(join(state, 'revisions'))
  await Promise.all([events.init(), revisions.init()])
  const surfaces = new SurfaceSessionService(events, revisions, work, state)
  await surfaces.init()
  const agents = new FakeAgents()
  const workspace = { paths: [] as string[], sessions: [] as string[] }
  const runtime = {
    agents,
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    sessions: { flush: () => Promise.resolve(true) },
    get: (name: string) => name === 'workspaceRegistry'
      ? { create: (path: string) => { workspace.paths.push(path); return Promise.resolve({ id: 'workspace-surfaces', attachSession: (id: ReturnType<typeof SessionId>) => { workspace.sessions.push(String(id)); return Promise.resolve() } }) } }
      : name === 'sessionPersistence'
      ? {
          list: () => Promise.resolve([...agents.stored.values()].map(session => ({ id: session.id }))),
          inspect: (id: ReturnType<typeof SessionId>) => {
            const session = agents.stored.get(String(id))
            if (session === undefined) return Promise.reject(new Error('missing persisted Session'))
            return Promise.resolve({ meta: session.header, events: session.events })
          },
        }
      : undefined,
  }
  const admission = new SurfaceSessionAdmission(runtime as unknown as Context, surfaces, () => Promise.resolve())
  return { admission, agents, runtime, surfaces, workspace, work }
}

describe('SurfaceSessionAdmission', () => {
  it('creates the real blank DSH Session and binds it before publication', async () => {
    const { admission, agents, surfaces, workspace, work } = await fixture()
    const result = await admission.ensure({ surfaceId: 'surface-a' })
    expect(result).toMatchObject({ surfaceId: 'surface-a', created: true, resumed: false })
    expect(agents.order).toEqual(['setup', 'publish'])
    expect(surfaces.bindingForSurface('surface-a')).toMatchObject({ sessionId: result.sessionId, inputSource: 'authoring' })
    expect(agents.live.get(result.sessionId)?.session.events).toEqual([])
    expect(workspace.paths).toEqual([work])
    expect(workspace.sessions).toEqual([result.sessionId])
  })

  it('does not return a Surface Session that native navigation cannot rediscover', async () => {
    const { admission, runtime } = await fixture()
    runtime.sessions.flush = () => Promise.resolve(false)
    await expect(admission.ensure({ surfaceId: 'surface-a' })).rejects.toMatchObject({
      code: 'effect-failed',
      message: expect.stringContaining('was not durable after Surface admission'),
    })
  })

  it('returns the same live Session and refuses to change its fixed input', async () => {
    const { admission } = await fixture()
    const first = await admission.ensure({ surfaceId: 'surface-a' })
    const second = await admission.ensure({ surfaceId: 'surface-a' })
    expect(second).toEqual({ surfaceId: 'surface-a', sessionId: first.sessionId, workspaceId: 'workspace-surfaces', created: false, resumed: false })
    await expect(admission.ensure({ surfaceId: 'surface-a', source: 'published' }))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
  })

  it('resumes the bound persisted Session instead of creating another identity or Turn', async () => {
    const { admission, agents, surfaces } = await fixture()
    const first = await admission.ensure({ surfaceId: 'surface-a' })
    agents.detach(first.sessionId)
    const resumed = await admission.ensure({ surfaceId: 'surface-a' })
    expect(resumed).toEqual({ surfaceId: 'surface-a', sessionId: first.sessionId, workspaceId: 'workspace-surfaces', created: false, resumed: true })
    expect(agents.order.slice(-2)).toEqual(['resume-setup', 'resume-publish'])
    expect(agents.live.get(first.sessionId)?.session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(surfaces.bindingForSurface('surface-a')?.sessionId).toBe(first.sessionId)
  })

  it('keeps a balanced idle Session cold during restart recovery', async () => {
    const { admission, agents } = await fixture()
    const first = await admission.ensure({ surfaceId: 'surface-a' })
    agents.detach(first.sessionId)
    expect(await admission.recoverAfterRestart()).toEqual([])
    expect(agents.live.get(first.sessionId)).toBeUndefined()
  })

  it('requires durable Session persistence instead of silently disabling automatic recovery', async () => {
    const { admission, agents, runtime } = await fixture()
    const first = await admission.ensure({ surfaceId: 'surface-a' })
    agents.detach(first.sessionId)
    runtime.get = () => undefined
    await expect(admission.recoverAfterRestart()).rejects.toMatchObject({
      code: 'effect-failed',
      message: expect.stringContaining('requires the DSH Session persistence service'),
    })
  })

  it('does not let a binding without a materialized Session log block startup recovery', async () => {
    const { admission, agents } = await fixture()
    const first = await admission.ensure({ surfaceId: 'surface-a' })
    agents.detach(first.sessionId)
    agents.stored.delete(first.sessionId)
    await expect(admission.recoverAfterRestart()).resolves.toEqual([])
  })

  it('isolates one unreadable Session while recovering other interrupted work', async () => {
    const { admission, agents, runtime } = await fixture()
    const broken = await admission.ensure({ surfaceId: 'surface-a' })
    const healthy = await admission.ensure({ surfaceId: 'surface-b' })
    for (const id of [broken.sessionId, healthy.sessionId]) {
      const session = agents.stored.get(id)!
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
      agents.detach(id)
    }
    const persistence = runtime.get('sessionPersistence') as {
      list(): Promise<readonly { readonly id: ReturnType<typeof SessionId> }[]>
      inspect(id: ReturnType<typeof SessionId>): Promise<{ readonly meta: SessionHeader; readonly events: readonly SessionEvent[] }>
    }
    runtime.get = name => name === 'sessionPersistence'
      ? {
          list: () => persistence.list(),
          inspect: (id: ReturnType<typeof SessionId>) => String(id) === broken.sessionId
            ? Promise.reject(new Error('corrupt fixture Session'))
            : persistence.inspect(id),
        }
      : undefined

    await expect(admission.recoverAfterRestart()).resolves.toEqual([
      { surfaceId: 'surface-b', sessionId: healthy.sessionId, cause: 'disposed' },
    ])
    expect(agents.live.has(healthy.sessionId)).toBe(true)
    expect(agents.live.has(broken.sessionId)).toBe(false)
  })

  it('declares persistence and Session lifecycle as installation dependencies', () => {
    expect(WorkSurfaceService.inject).toEqual(expect.arrayContaining(['sessions', 'sessionPersistence', 'workspaceRegistry']))
    expect(KNOWN_SESSION_EVENT_TYPES.has('worksurface/binding')).toBe(true)
  })
})
