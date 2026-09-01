// Invariant assertions: [WS-01] [WS-09] [WS-10] [WS-12] [WS-13] [WS-14] [WS-21] [WS-27]
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { FileEventStore, RevisionStore, SURFACE_TEMPLATE } from '@pf-worksurface/core'
import { afterEach, describe, expect, it } from 'vitest'
import { SurfaceSessionService, supportsPersistedIgnorableSessionEvents } from '../src/session-surface.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-session-')); roots.push(root)
  const work = join(root, 'work'); const state = join(root, 'state')
  for (const id of ['surface-a', 'surface-b']) {
    await mkdir(join(work, 'surfaces', id), { recursive: true })
    await writeFile(join(work, 'surfaces', id, 'surface.md'), SURFACE_TEMPLATE)
  }
  const events = new FileEventStore(join(state, 'events'))
  const revisions = new RevisionStore(join(state, 'revisions'))
  await Promise.all([events.init(), revisions.init()])
  const service = new SurfaceSessionService(events, revisions, work, state)
  await service.init()
  return { root, work, state, events, revisions, service }
}

function session(id: string, cwd?: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 0,
    ...(cwd === undefined ? {} : { cwd }),
  })
}

function start(service: SurfaceSessionService, current: Session, number = 1): string {
  current.append('turn/start', { turn: number })
  const capability = service.beginTurn(current, number)
  if (capability === undefined) throw new Error('expected a Surface Session capability')
  return capability
}

describe('SurfaceSessionService', () => {
  it('binds one Surface to one DSH Session before its first Turn', async () => {
    const { service, state, work } = await fixture()
    const current = session('session-a', service.cwdForSurface('surface-a'))
    expect(current.header.cwd).toBe(work)
    const binding = await service.bindSession(current, 'surface-a', 'authoring')
    expect(binding).toMatchObject({ sessionId: 'session-a', surfaceId: 'surface-a', inputSource: 'authoring' })
    expect(current.events).toEqual([])
    expect(JSON.parse(await readFile(join(state, 'surface-sessions', 'surface-a', 'context.json'), 'utf8')))
      .toMatchObject({ execution: { sessionId: 'session-a' }, surface: { id: 'surface-a' }, capabilities: { targetSurfaces: ['surface-a'] } })
    expect(service.bindingForSession('session-a')).toEqual(binding)
    expect(service.bindingForSurface('surface-a')).toEqual(binding)
  })

  it('requires compatible live Session and persistence implementations for extension facts', async () => {
    const { service } = await fixture()
    const current = session('legacy-host', service.cwdForSurface('surface-a'))
    const binding = {
      version: 1 as const,
      surfaceId: 'surface-a',
      sessionId: 'legacy-host',
      inputSource: 'authoring' as const,
      inputRevision: `sha256:${'a'.repeat(64)}` as const,
      expectedHead: null,
    }
    Object.defineProperty(current, 'constructor', {
      value: {
        create: () => ({ append: () => ({ type: 'worksurface/binding' }) }),
      },
    })

    const currentPersistence = { borrowSession() {}, ensureMaterialized() {} }
    expect(supportsPersistedIgnorableSessionEvents(current, binding, currentPersistence)).toBe(false)
    expect(supportsPersistedIgnorableSessionEvents(session('modern-host'), binding, {})).toBe(false)
    expect(supportsPersistedIgnorableSessionEvents(session('modern-host'), binding, currentPersistence)).toBe(true)
  })

  it('rejects both a second Session for one Surface and a second Surface for one Session', async () => {
    const { service } = await fixture()
    const first = session('session-one', service.cwdForSurface('surface-a'))
    await service.bindSession(first, 'surface-a', 'authoring')
    await expect(service.bindSession(session('session-two', service.cwdForSurface('surface-a')), 'surface-a', 'authoring'))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
    await expect(service.bindSession(first, 'surface-b', 'authoring'))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
  })

  it('requires the public authoring root as cwd and binding before the first Turn', async () => {
    const { service } = await fixture()
    await expect(service.bindSession(session('wrong-cwd'), 'surface-a', 'authoring'))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
    const late = session('late', service.cwdForSurface('surface-b'))
    late.append('turn/start', { turn: 1 })
    await expect(service.bindSession(late, 'surface-b', 'authoring'))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
  })

  it('rejects a symlinked public surfaces root without touching its target', async () => {
    const { root, service, work } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(join(outside, 'surface-a'), { recursive: true })
    await writeFile(join(outside, 'surface-a', 'sentinel'), 'keep\n')
    await rm(join(work, 'surfaces'), { recursive: true })
    await symlink(outside, join(work, 'surfaces'))

    await expect(service.bindSession(session('session-symlink', service.cwdForSurface('surface-a')), 'surface-a', 'authoring'))
      .rejects.toMatchObject({ code: 'invalid-working-copy' })
    expect(await readFile(join(outside, 'surface-a', 'sentinel'), 'utf8')).toBe('keep\n')
  })

  it('does not activate ordinary DSH Sessions', async () => {
    const { service } = await fixture()
    const ordinary = session('ordinary')
    ordinary.append('turn/start', { turn: 1 })
    expect(service.beginTurn(ordinary, 1)).toBeUndefined()
    expect(service.activeSurface('ordinary')).toBeUndefined()
  })

  // Model-readiness evidence: [MR-TURN-BRIEF-L1]
  it('authorizes planning only for the current live Turn capability', async () => {
    const { service } = await fixture()
    const current = session('session-planner', service.cwdForSurface('surface-a'))
    await service.bindSession(current, 'surface-a', 'authoring')
    service.prepareTurnBrief('surface-a', {
      instruction: 'Review the current evidence.',
      outputs: [{
        name: 'review.completed',
        description: 'the review is complete',
        payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
      }],
    })
    const capability = start(service, current)
    expect(service.planningSource(capability)).toEqual({ surfaceId: 'surface-a', sessionId: 'session-planner', turn: 1 })
    const active = service.activeSurface('session-planner')!
    expect(JSON.parse(await readFile(join(active.viewDir, 'turn-brief.json'), 'utf8'))).toMatchObject({
      version: 1,
      runtimeView: '$DSH_WORKSURFACE_VIEW_DIR',
      instruction: 'Review the current evidence.',
      outputs: [{ name: 'review.completed', command: { argv: ['$DSH_WORKSURFACE_CLI', 'emit', 'review.completed', '--payload', '<JSON matching schema>'] } }],
    })
    service.endTurn('session-planner', 1)
    expect(() => service.planningSource(capability)).toThrowError(expect.objectContaining({ code: 'unauthorized' }))
  })

  // Model-readiness evidence: [MR-SURFACE-AUTHORING-L2]
  it('preserves unpublished WIP across later Turns of the same Surface Session', async () => {
    const { service } = await fixture()
    const current = session('session-wip', service.cwdForSurface('surface-a'))
    await service.bindSession(current, 'surface-a', 'authoring')
    start(service, current, 1)
    const first = service.activeSurface('session-wip')!
    await writeFile(join(first.cwd, 'notes.md'), 'unpublished\n')
    current.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    service.endTurn('session-wip', 1)
    const secondCapability = start(service, current, 2)
    const second = service.activeSurface('session-wip')!
    expect(second.capability).toBe(secondCapability)
    expect(second.cwd).toBe(first.cwd)
    expect(await readFile(join(second.cwd, 'notes.md'), 'utf8')).toBe('unpublished\n')
  })

  // Model-readiness evidence: [MR-AUTHORIZED-OUTPUT-L2]
  it('publishes with Session/Turn evidence and revokes authority at Turn end', async () => {
    const { service } = await fixture()
    const current = session('session-publish', service.cwdForSurface('surface-a'))
    await service.bindSession(current, 'surface-a', 'authoring')
    const capability = start(service, current)
    const surface = service.activeSurface('session-publish')!
    await writeFile(join(surface.cwd, 'result.md'), 'done\n')
    const ref = await service.emitTurn(capability, 'surface.revision.published', { summary: 'done' })
    expect(ref.subject).toBe('surface:surface-a')
    expect((await service.replaySurface('surface-a'))[0]).toMatchObject({
      name: 'surface.revision.published',
      meta: { sessionId: 'session-publish', turn: 1, outputRevision: expect.stringMatching(/^sha256:/) },
    })
    expect(current.events.filter(event => event.type === 'worksurface/binding')).toHaveLength(0)
    service.endTurn('session-publish', 1)
    await expect(service.emitTurn(capability, 'review.accepted', {})).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('recovers the one-to-one binding and authoring WIP without opening a Surface', async () => {
    const { events, revisions, service, work, state } = await fixture()
    const original = session('session-recover', service.cwdForSurface('surface-a'))
    await service.bindSession(original, 'surface-a', 'authoring')
    const capability = start(service, original)
    const cwd = service.activeSurface('session-recover')!.cwd
    await writeFile(join(cwd, 'wip.md'), 'kept\n')
    service.endTurn('session-recover')
    await rm(join(state, 'surface-sessions', 'surface-a', 'authoring.initialized'))

    const recovered = new SurfaceSessionService(events, revisions, work, state)
    await recovered.init()
    const resumed = Session.create(SessionId('session-recover'), original.events, original.header)
    const resumedCapability = start(recovered, resumed, 2)
    expect(resumedCapability).not.toBe(capability)
    expect(recovered.activeSurface('session-recover')!.cwd).toBe(cwd)
    expect(await readFile(join(cwd, 'wip.md'), 'utf8')).toBe('kept\n')
  })

  it('rematerializes a missing authoring directory when its marker survived', async () => {
    const { events, revisions, service, work, state } = await fixture()
    const original = session('session-rematerialize', service.cwdForSurface('surface-a'))
    await service.bindSession(original, 'surface-a', 'authoring')
    await rm(join(work, 'surfaces', 'surface-a'), { recursive: true })

    const recovered = new SurfaceSessionService(events, revisions, work, state)
    await recovered.init()
    expect(await readFile(join(work, 'surfaces', 'surface-a', 'surface.md'), 'utf8')).toBe(SURFACE_TEMPLATE)
  })

  it('resumes a legacy private-worktree binding without losing unpublished WIP', async () => {
    const { events, revisions, service, work, state } = await fixture()
    const original = session('session-legacy', service.cwdForSurface('surface-a'))
    await service.bindSession(original, 'surface-a', 'authoring')
    const legacyRoot = join(state, 'surface-sessions', 'surface-a')
    const legacyWorktree = join(legacyRoot, 'work')
    await rm(join(legacyRoot, 'authoring.initialized'))
    await mkdir(legacyWorktree)
    await writeFile(join(legacyRoot, 'work.initialized'), 'legacy\n')
    await writeFile(join(legacyWorktree, 'surface.md'), SURFACE_TEMPLATE)
    await writeFile(join(legacyWorktree, 'wip.md'), 'legacy unpublished\n')

    const recovered = new SurfaceSessionService(events, revisions, work, state)
    await recovered.init()
    const resumed = Session.create(SessionId('session-legacy'), original.events, { ...original.header, cwd: legacyWorktree })
    await recovered.bindSession(resumed, 'surface-a', 'authoring')
    start(recovered, resumed, 1)
    expect(recovered.activeSurface('session-legacy')!.cwd).toBe(legacyWorktree)
    expect(await readFile(join(legacyWorktree, 'wip.md'), 'utf8')).toBe('legacy unpublished\n')
  })

  it('keeps business events but rejects forged publication events', async () => {
    const { service } = await fixture()
    await service.appendSurface('surface-a', { id: 'business', name: 'review.accepted', payload: { ok: true } })
    await expect(service.appendSurface('surface-a', { id: 'forged', name: 'surface.revision.published', payload: {} }))
      .rejects.toMatchObject({ code: 'unauthorized' })
    expect((await service.replaySurface('surface-a')).map(event => event.name)).toEqual(['review.accepted'])
  })
})
