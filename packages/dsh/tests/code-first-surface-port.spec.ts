import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EventContractStore,
  FileEventStore,
  InputLedgerStore,
  RevisionStore,
  RuntimeAuthorityStore,
  RuntimeEventStore,
  type Revision,
} from '@pf-worksurface/core'
import { DshCodeFirstSurfacePort } from '../src/code-first-surface-port.ts'
import { SurfaceSessionService } from '../src/session-surface.ts'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'

// Invariant assertions: [WS-25] [WS-26]

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('code-first Surface fact projection', () => {
  it('recovers real Session context from the runtime head before restoring missing authoring, without regressing on old apply retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-session-head-recovery-')); roots.push(root)
    const workRoot = join(root, 'work'), targetRoot = join(root, 'target'), stateRoot = join(root, 'legacy')
    const surface = join(workRoot, 'surfaces', 'case-a')
    await mkdir(surface, { recursive: true })
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('base'))
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(targetRoot).init()
    const contracts = new EventContractStore(join(targetRoot, 'contracts'))
    const events = new RuntimeEventStore(join(targetRoot, 'events'), authority.id, contracts)
    const oldEvents = new FileEventStore(join(stateRoot, 'events')); await oldEvents.init()
    const sessions = new SurfaceSessionService(oldEvents, revisions, workRoot, stateRoot)
    const context = { agents: { get: () => undefined } } as never
    const port = new DshCodeFirstSurfacePort(context, workRoot, targetRoot, revisions, events, contracts, sessions)
    sessions.registerRevisionHead(id => port.recordedHead(id))
    await sessions.init()
    const base = await port.head('case-a')
    const id = SessionId('durable-session')
    const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: workRoot })
    await sessions.bindSession(session, 'case-a', 'authoring')
    const candidateRoot = join(root, 'candidate'); await revisions.materialize(base, candidateRoot)
    await writeFile(join(candidateRoot, 'answer.txt'), 'applied\n')
    const candidate = (await revisions.snapshotSurface(candidateRoot)).revision
    const evidence = { registrationId: 'r', runId: '1', causes: [] }
    await port.apply('case-a', base, candidate, evidence)
    await writeFile(join(surface, 'published.txt'), 'later\n')
    await port.publishTurn('case-a', { sessionId: id, turn: 1, expectedRevision: candidate })
    const published = await port.head('case-a')
    await port.apply('case-a', base, candidate, evidence)
    await rm(surface, { recursive: true })

    const recoveredSessions = new SurfaceSessionService(oldEvents, revisions, workRoot, stateRoot)
    const recoveredPort = new DshCodeFirstSurfacePort(context, workRoot, targetRoot, revisions, events, contracts, recoveredSessions)
    recoveredSessions.registerRevisionHead(surfaceId => recoveredPort.recordedHead(surfaceId))
    await recoveredPort.recover()
    await recoveredSessions.init()
    await recoveredSessions.bindSession(session, 'case-a', 'authoring')
    session.append('turn/start', { turn: 2 })
    recoveredSessions.beginTurn(session, 2)
    expect(recoveredSessions.activeSurface(id)?.revision).toMatchObject({ inputRevision: published, expectedHead: published })
    expect(await readFile(join(surface, 'answer.txt'), 'utf8')).toBe('applied\n')
    expect(await readFile(join(surface, 'published.txt'), 'utf8')).toBe('later\n')
    await writeFile(join(surface, 'wip.txt'), 'unpublished after restart\n')
    await recoveredSessions.recover()
    expect(await readFile(join(surface, 'wip.txt'), 'utf8')).toBe('unpublished after restart\n')
    expect(await recoveredPort.head('case-a')).toBe(published)
    expect(await oldEvents.replay({ kind: 'surface', id: 'case-a' })).toEqual([])
  })
  it('derives head from immutable Runtime Events and recovers an interrupted authoring swap idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-target-head-')); roots.push(root)
    const workRoot = join(root, 'work')
    const surface = join(workRoot, 'surfaces', 'case-a')
    await mkdir(surface, { recursive: true })
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('base'))

    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const adoptRuntimeRevision = vi.fn(async () => undefined)
    const sessions = { bindingForSurface: () => undefined, adoptRuntimeRevision } as never
    const context = { agents: { get: () => undefined } } as never
    const port = new DshCodeFirstSurfacePort(context, workRoot, join(root, 'target'), revisions, events, contracts, sessions)

    const base = await port.head('case-a')
    expect((await events.replay('case-a')).map(event => event.type.name)).toEqual(['surface.revision.admitted'])

    const candidateRoot = join(root, 'candidate')
    await mkdir(candidateRoot)
    await writeFile(join(candidateRoot, 'surface.md'), surfaceMarkdown('candidate'))
    const candidate = (await revisions.snapshotSurface(candidateRoot)).revision

    // Simulate a crash after replacing authoring but before recording the applied fact.
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('candidate'))
    await port.apply('case-a', base, candidate, { registrationId: 'flow', runId: 'run-1', causes: [] })
    expect(await port.head('case-a')).toBe(candidate)
    expect(await readFile(join(surface, 'surface.md'), 'utf8')).toBe(surfaceMarkdown('candidate'))
    expect((await events.replay('case-a')).map(event => event.type.name)).toEqual([
      'surface.revision.admitted',
      'surface.revision.applied',
    ])

    const restarted = new DshCodeFirstSurfacePort(context, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    await restarted.apply('case-a', base, candidate, { registrationId: 'flow', runId: 'run-1', causes: [] })
    expect(await restarted.head('case-a')).toBe(candidate)
    expect((await events.replay('case-a'))).toHaveLength(2)
    expect(adoptRuntimeRevision).toHaveBeenCalledWith('case-a', candidate)
  })

  it('projects an authorized Session publication as the latest head fact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-target-publish-')); roots.push(root)
    const workRoot = join(root, 'work')
    const surface = join(workRoot, 'surfaces', 'case-a')
    await mkdir(surface, { recursive: true })
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('base'))
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const sessions = { bindingForSurface: () => undefined, adoptRuntimeRevision: async () => undefined } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined } } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    const base = await port.head('case-a')

    const publishedRoot = join(root, 'published')
    await mkdir(publishedRoot)
    await writeFile(join(publishedRoot, 'surface.md'), surfaceMarkdown('published'))
    const published = (await revisions.snapshotSurface(publishedRoot)).revision
    await port.recordPublished('case-a', { sessionId: 'session-a', turn: 3, expectedRevision: base, revision: published, summary: 'done' })

    expect(await port.head('case-a')).toBe(published)
    const event = (await events.replay('case-a')).at(-1)!
    expect(event.type.name).toBe('surface.revision.published')
    expect(event.payload).toMatchObject({ revision: published, expectedRevision: base, summary: 'done' })
  })

  it('adapts DSH tool completion by reference and reconstructs only completion metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-dsh-adapter-')); roots.push(root)
    const workRoot = join(root, 'work')
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const session = {
      id: 'session-a',
      snapshotEvents() { return this.events },
      events: [
        { seq: 0, type: 'tool/call', data: { turn: 2, step: 1, callId: 'call-1', name: 'read_file', arguments: '{"path":"secret"}' } },
        {
          seq: 1,
          type: 'tool/result',
          data: {
            turn: 2,
            step: 1,
            message: {
              content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'private body' }] }],
            },
          },
        },
      ],
    }
    const sessions = {
      bindingForSession: () => ({ surfaceId: 'case-a', sessionId: 'session-a' }),
      bindingForSurface: () => ({ surfaceId: 'case-a', sessionId: 'session-a' }),
      adoptRuntimeRevision: async () => undefined,
    } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => ({ session }) } } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    const adapted = port.adaptDshToolCompletion(session as never, session.snapshotEvents()[1] as never)!
    const resolved = await port.resolveDshInput(adapted.ref)

    expect(adapted.surfaceId).toBe('case-a')
    expect(resolved).toEqual({
      surfaceId: 'case-a',
      name: 'dsh.tool.completed',
      payload: { turn: 2, step: 1, callId: 'call-1', toolName: 'read_file', status: 'succeeded' },
    })
    expect(JSON.stringify(resolved)).not.toContain('private body')
    expect(JSON.stringify(resolved)).not.toContain('secret')
    const inspect = vi.fn(async () => ({ meta: { id: 'session-a' }, events: session.events }))
    const create = vi.fn(), resume = vi.fn()
    const coldPort = new DshCodeFirstSurfacePort({ agents: { get: () => undefined, create, resume }, get: (name: string) => name === 'sessionPersistence' ? { inspect } : undefined } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    expect(await coldPort.resolveExternalInput(adapted.ref)).toEqual(resolved)
    expect(inspect).toHaveBeenCalledWith('session-a')
    expect(await coldPort.historyBoundary('case-a')).toMatchObject({ externalEventSeq: 1 })
    expect(create).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    inspect.mockResolvedValueOnce({ meta: { id: 'different-session' }, events: session.events })
    await expect(coldPort.resolveExternalInput(adapted.ref)).rejects.toMatchObject({ code: 'canonical-corrupt' })
    const notYetMaterialized = new DshCodeFirstSurfacePort({ agents: { get: () => undefined }, get: () => ({ inspect, list: async () => [] }) } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    expect(await notYetMaterialized.historyBoundary('case-a')).toMatchObject({ externalEventSeq: -1 })
  })

  it('isolates incomplete unadmitted authoring directories while restoring healthy heads', async () => {
    const f = await recoveryFixture()
    await mkdir(join(f.workRoot, 'surfaces', 'incomplete'))
    const failures = await f.port.recoverHeads({ isolateFailures: true })
    expect(failures).toEqual([{ surfaceId: 'incomplete', error: expect.any(String) }])
    expect(await f.port.recordedHead('healthy')).toBeDefined()
    expect(await f.events.replay('incomplete')).toEqual([])
    expect(f.adopt).toHaveBeenCalledWith('healthy', expect.stringMatching(/^sha256:/))
    await expect(f.port.recoverHeads()).rejects.toThrow()
  })

  it('does not hide failures of admitted Surfaces or corrupted durable events', async () => {
    const f = await recoveryFixture()
    await f.port.head('healthy')
    f.adopt.mockRejectedValueOnce(new Error('existing Session context cannot be restored'))
    await expect(f.port.recoverHeads({ isolateFailures: true })).rejects.toThrow('existing Session context cannot be restored')
    await writeFile(join(f.events.root, 'surfaces', 'healthy.jsonl'), 'invalid durable stream\n')
    await expect(f.port.recoverHeads({ isolateFailures: true })).rejects.toMatchObject({ code: 'canonical-corrupt' })
  })

  it('replays missed external wakeups from cold Sessions and keeps independent inputs after a failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-external-recovery-')); roots.push(root)
    const authority = (await new RuntimeAuthorityStore(join(root, 'target')).init()).id
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority, contracts)
    const revisions = new RevisionStore(join(root, 'revisions'))
    const inputs = new InputLedgerStore(join(root, 'target', 'inputs'), authority)
    const history = [0, 2].flatMap(seq => [
      { seq, type: 'tool/call', data: { turn: 0, step: seq, callId: `call-${seq}`, name: 'bash', arguments: '{}' } },
      { seq: seq + 1, type: 'tool/result', data: { turn: 0, step: seq, message: { content: [{ type: 'tool-result', toolCallId: `call-${seq}`, content: [{ type: 'text', text: 'private tool body' }] }] } } },
    ])
    const inspect = vi.fn(async (id: string) => { if (id === 'session-b') throw new Error('unreadable sibling Session'); return { meta: { id }, events: history } })
    const create = vi.fn(), resume = vi.fn()
    const sessions = {
      listBindings: () => [{ surfaceId: 'case-a', sessionId: 'session-a' }, { surfaceId: 'case-b', sessionId: 'session-b' }],
      bindingForSurface: () => undefined, adoptRuntimeRevision: async () => undefined,
    } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined, create, resume }, get: () => ({ inspect }) } as never, join(root, 'work'), join(root, 'target'), revisions, events, contracts, sessions)
    const accept = vi.fn(async (ref, surfaceId, name) => {
      expect(surfaceId).toBe('case-a'); expect(name).toBe('dsh.tool.completed')
      await inputs.append('delegate', ref)
      if (ref.seq === 1) throw new Error('one registration could not run yet')
    })
    const failures = await port.recoverExternalInputs(accept)
    expect(failures).toEqual([{ surfaceId: 'case-a', error: 'one registration could not run yet' }, { surfaceId: 'case-b', error: 'unreadable sibling Session' }])
    expect((await inputs.replay('delegate')).map(record => record.event.seq)).toEqual([1, 3])
    await port.recoverExternalInputs(accept)
    expect(await inputs.replay('delegate')).toHaveLength(2)
    expect(JSON.stringify(accept.mock.calls)).not.toContain('private tool body')
    expect(create).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled()
  })

  it('persists the specific message grant before delivering an advance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-advance-brief-')); roots.push(root)
    const target = join(root, 'target')
    const authority = (await new RuntimeAuthorityStore(target).init()).id
    const contracts = new EventContractStore(join(target, 'contracts'))
    const events = new RuntimeEventStore(join(target, 'events'), authority, contracts)
    let saved = false
    const prepare = vi.fn(async () => { saved = true })
    const followup = vi.fn(async () => { expect(saved).toBe(true); return { sessionId: 'target-session', turnId: '1' } })
    const sessions = { prepareFollowupBrief: prepare, followupSurface: followup } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined } } as never, join(root, 'work'), target, new RevisionStore(join(root, 'revisions')), events, contracts, sessions)
    await port.advance('case-a', 'Review the supplied evidence.', [], [], 'advance-one')
    expect(prepare).toHaveBeenCalledWith('case-a', 'ws-advance-advance-one', { instruction: 'Review the supplied evidence.', inputs: [], outputs: [] })
    expect(followup).toHaveBeenCalledWith('case-a', expect.stringContaining('Review the supplied evidence.'), 'ws-advance-advance-one')
    prepare.mockRejectedValueOnce(new Error('brief storage unavailable'))
    await expect(port.advance('case-a', 'Second request.', [], [], 'advance-two')).rejects.toThrow('brief storage unavailable')
    expect(followup).toHaveBeenCalledTimes(1)
  })
})

async function recoveryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-head-isolation-')); roots.push(root)
  const workRoot = join(root, 'work'), target = join(root, 'target')
  await mkdir(join(workRoot, 'surfaces', 'healthy'), { recursive: true })
  await writeFile(join(workRoot, 'surfaces', 'healthy', 'surface.md'), surfaceMarkdown('healthy'))
  const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
  const authority = (await new RuntimeAuthorityStore(target).init()).id
  const contracts = new EventContractStore(join(target, 'contracts'))
  const events = new RuntimeEventStore(join(target, 'events'), authority, contracts)
  const adopt = vi.fn(async (_surface: string, _revision: Revision) => undefined)
  const sessions = { bindingForSurface: () => undefined, adoptRuntimeRevision: adopt } as never
  const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined } } as never, workRoot, target, revisions, events, contracts, sessions)
  return { workRoot, port, events, adopt }
}

function surfaceMarkdown(value: string): string {
  return `# Goal\n${value}\n\n# Acceptance Criteria\nDone.\n\n# Known Facts and Constraints\nNone.\n\n# Assumptions\nNone.\n\n# Open Questions\nNone.\n\n# Current Decisions\nNone.\n\n# Deliverables and Evidence\nNone.\n`
}
