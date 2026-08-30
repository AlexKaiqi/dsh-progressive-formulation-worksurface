import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DefinitionStore,
  FileEventStore,
  RevisionStore,
  SURFACE_TEMPLATE,
  type EventDraft,
  type EventRef,
  type OrchestrationDefinition,
  type Revision,
  type WorkSurfaceEvent,
} from '@pf-worksurface/core'
import { SurfaceSessionService } from '../src/session-surface.ts'
import { WorkSurfaceEngine, type CodeHandlerRunner, type WorkSurfaceEventPort } from '../src/engine.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

const revision = `sha256:${'a'.repeat(64)}` as Revision
const definition: OrchestrationDefinition = {
  version: 1,
  roles: ['reviewA', 'reviewB', 'target'],
  subscriptions: [{
    id: 'join', history: 'all', key: '$.payload.caseId',
    when: { all: [{ role: 'reviewA', event: 'review.accepted' }, { role: 'reviewB', event: 'review.accepted' }] },
    reaction: { emit: [{ role: 'target', event: 'review.bundle.ready', operationKey: 'advance', payload: { caseId: '${activation.key}' } }] },
  }],
}
const noCode: CodeHandlerRunner = { run: () => Promise.reject(new Error('unexpected handler')) }

async function fixture(portWrapper?: (port: WorkSurfaceEventPort) => WorkSurfaceEventPort) {
  const root = await mkdtemp(join(tmpdir(), 'ws-engine-v1-')); roots.push(root)
  const work = join(root, 'work'); const state = join(root, 'state')
  await mkdir(join(work, 'surfaces', 'target'), { recursive: true })
  await writeFile(join(work, 'surfaces', 'target', 'surface.md'), SURFACE_TEMPLATE)
  const store = new FileEventStore(join(state, 'events'))
  const revisions = new RevisionStore(join(state, 'revisions'))
  await Promise.all([store.init(), revisions.init()])
  const surfaces = new SurfaceSessionService(store, revisions, work, state)
  await surfaces.init()
  const definitions = new DefinitionStore(join(state, 'definitions'))
  const port = portWrapper?.(surfaces) ?? surfaces
  const engine = new WorkSurfaceEngine(definitions, port, noCode)
  return { root, work, state, store, surfaces, definitions, engine }
}

async function seedJoin(surfaces: SurfaceSessionService): Promise<void> {
  await surfaces.appendSurface('review-a', { id: 'a-ready', name: 'review.accepted', payload: { caseId: 'case-1' } })
  await surfaces.appendSurface('review-b', { id: 'b-ready', name: 'review.accepted', payload: { caseId: 'case-1' } })
}

describe('WorkSurfaceEngine v1', () => {
  it('routes a declarative followup to the explicitly bound DSH Session', async () => {
    const { engine, surfaces } = await fixture()
    const delivered: { sessionId: string; message: string; messageId: string }[] = []
    surfaces.registerFollowupRouter((surfaceId, message, messageId) => {
      const sessionId = surfaces.bindingForSurface(surfaceId)?.sessionId
      if (sessionId === undefined) throw new Error('expected bound target Surface')
      delivered.push({ sessionId, message, messageId })
      return Promise.resolve({ sessionId, messageId })
    })
    const targetId = SessionId('session-target')
    await surfaces.bindSession(Session.create(targetId, undefined, {
      version: 0, id: targetId, createdAt: 0, cwd: surfaces.cwdForSurface('target'),
    }), 'target', 'authoring')
    await surfaces.appendSurface('review-a', { id: 'ready-followup', name: 'review.accepted', payload: { caseId: 'case-7' } })
    const followupDefinition: OrchestrationDefinition = {
      version: 1,
      roles: ['source', 'target'],
      subscriptions: [{
        id: 'continue-target', history: 'all',
        when: { role: 'source', event: 'review.accepted' },
        reaction: { followup: [{ role: 'target', message: 'Open delivery-${activation.key}', operationKey: 'continue' }] },
      }],
    }
    await engine.register({
      orchestrationId: 'followup', registrationId: 'reg-followup', definitionRevision: revision,
      definition: followupDefinition, bindings: { source: 'review-a', target: 'target' },
    })
    expect(delivered).toEqual([{ sessionId: 'session-target', message: 'Open delivery-ready-followup', messageId: expect.stringMatching(/^worksurface:/) }])
    expect((await engine.inspect('reg-followup')).pendingOperations).toEqual([])
  })

  it('replays historical evidence into one keyed activation and one managed target event', async () => {
    const { engine, surfaces } = await fixture()
    await seedJoin(surfaces)
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-reviews', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    await engine.reconcile('reg-reviews')
    const target = await surfaces.replaySurface('target')
    expect(target).toHaveLength(1)
    expect(target[0]).toMatchObject({ name: 'review.bundle.ready', payload: { caseId: 'case-1' }, meta: { registrationId: 'reg-reviews' } })
    const inspection = await engine.inspect('reg-reviews')
    expect(inspection.activations).toHaveLength(1)
    expect(inspection.actual).toHaveLength(2)
    expect(inspection.pendingOperations).toEqual([])
  })

  it('serializes Registration admission so identical retries are idempotent and conflicts cannot poison replay', async () => {
    const { engine, surfaces } = await fixture()
    const input = {
      orchestrationId: 'reviews', registrationId: 'reg-idempotent', definitionRevision: revision, definition,
      bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' },
    } as const
    await Promise.all([engine.register(input), engine.register(input)])
    expect((await surfaces.replayRegistration('reg-idempotent')).filter(event => event.name === 'registration.registered')).toHaveLength(1)
    await expect(engine.register({ ...input, bindings: { ...input.bindings, target: 'other-target' } }))
      .rejects.toMatchObject({ code: 'already-exists-conflict' })
    expect((await surfaces.replayRegistration('reg-idempotent')).filter(event => event.name === 'registration.registered')).toHaveLength(1)
    expect((await engine.inspect('reg-idempotent')).bindings).toEqual(input.bindings)
  })

  it('recovers target append before settlement without duplicating the target event', async () => {
    let failSettlement = true
    const { engine, surfaces } = await fixture(port => ({
      ...port,
      appendSurface: port.appendSurface.bind(port),
      replaySurface: port.replaySurface.bind(port),
      replayRegistration: port.replayRegistration.bind(port),
      appendRegistration: async (id: string, draft: EventDraft): Promise<EventRef> => {
        if (failSettlement && draft.name === 'registration.operation-settled') { failSettlement = false; throw new Error('crash after append') }
        return port.appendRegistration(id, draft)
      },
    }))
    await seedJoin(surfaces)
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-crash', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    expect((await engine.inspect('reg-crash')).pendingOperations).toHaveLength(1)
    await engine.reconcile('reg-crash')
    expect(await surfaces.replaySurface('target')).toHaveLength(1)
    expect((await engine.inspect('reg-crash')).pendingOperations).toEqual([])
  })

  it('recovers an operation intent written before the target append', async () => {
    let failTarget = true
    const { engine, surfaces } = await fixture(port => ({
      ...port,
      replaySurface: port.replaySurface.bind(port),
      appendRegistration: port.appendRegistration.bind(port),
      replayRegistration: port.replayRegistration.bind(port),
      appendSurface: async (id: string, draft: EventDraft, options): Promise<EventRef> => {
        if (failTarget && id === 'target' && draft.name === 'review.bundle.ready') { failTarget = false; throw new Error('crash before target append') }
        return port.appendSurface(id, draft, options)
      },
    }))
    await seedJoin(surfaces)
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-before-target', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    expect((await engine.inspect('reg-before-target')).pendingOperations).toHaveLength(1)
    await engine.reconcile('reg-before-target')
    expect(await surfaces.replaySurface('target')).toHaveLength(1)
    expect((await engine.inspect('reg-before-target')).pendingOperations).toEqual([])
  })

  it('converges after process restart using only immutable Definition and event facts', async () => {
    const { definitions, engine, surfaces } = await fixture()
    await seedJoin(surfaces)
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-restart', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    const restarted = new WorkSurfaceEngine(definitions, surfaces, noCode)
    await restarted.reconcile('reg-restart')
    expect(await surfaces.replaySurface('target')).toHaveLength(1)
    expect((await restarted.inspect('reg-restart')).status).toBe('active')
  })

  it('converges under lost, duplicate, and reordered live wakeups', async () => {
    const { definitions, engine, surfaces } = await fixture()
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-wakeups', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    await surfaces.appendSurface('review-b', { id: 'b-first', name: 'review.accepted', payload: { caseId: 'case-1' } })
    await engine.reconcile('reg-wakeups')
    await engine.reconcile('reg-wakeups')
    expect(await surfaces.replaySurface('target')).toEqual([])

    // The review-a wakeup is deliberately "lost". A fresh process replays it,
    // while repeated reconciles model duplicate delivery of later wakeups.
    await surfaces.appendSurface('review-a', { id: 'a-lost-wakeup', name: 'review.accepted', payload: { caseId: 'case-1' } })
    const restarted = new WorkSurfaceEngine(definitions, surfaces, noCode)
    await restarted.reconcile('reg-wakeups')
    await Promise.all([restarted.reconcile('reg-wakeups'), restarted.reconcile('reg-wakeups')])
    expect(await surfaces.replaySurface('target')).toHaveLength(1)
    const inspection = await restarted.inspect('reg-wakeups')
    expect(inspection.activations).toHaveLength(1)
    expect(inspection.pendingOperations).toEqual([])
  })

  it('retries a handler and rejects duplicate operation keys before target append', async () => {
    const { definitions, surfaces } = await fixture()
    await surfaces.appendSurface('review-a', { id: 'ready', name: 'ready', payload: {} })
    let attempt = 0
    const runner: CodeHandlerRunner = { run: async () => {
      attempt += 1
      if (attempt === 1) throw new Error('handler crashed')
      return [
        { targetRole: 'target', name: 'one', payload: null, operationKey: 'same' },
        { targetRole: 'target', name: 'two', payload: null, operationKey: 'same' },
      ]
    } }
    const codeDefinition: OrchestrationDefinition = {
      version: 1, roles: ['source', 'target'], subscriptions: [{ id: 'code', history: 'all', when: { role: 'source', event: 'ready' },
        reaction: { handler: { command: 'node', path: 'handlers/run.mjs', reads: ['source'], emits: ['target'] } } }],
    }
    const codeEngine = new WorkSurfaceEngine(definitions, surfaces, runner)
    await codeEngine.register({ orchestrationId: 'code', registrationId: 'reg-code', definitionRevision: revision, definition: codeDefinition, bindings: { source: 'review-a', target: 'target' } })
    await codeEngine.reconcile('reg-code')
    expect(attempt).toBe(1)
    await codeEngine.pause('reg-code')
    await codeEngine.resume('reg-code')
    expect(attempt).toBe(2)
    expect((await surfaces.replaySurface('target')).filter((event: WorkSurfaceEvent) => event.name === 'one' || event.name === 'two')).toEqual([])
  })

  it('persists every pause/resume transition instead of deduplicating later cycles', async () => {
    const { engine } = await fixture()
    await engine.register({ orchestrationId: 'reviews', registrationId: 'reg-status', definitionRevision: revision, definition, bindings: { reviewA: 'review-a', reviewB: 'review-b', target: 'target' } })
    await engine.pause('reg-status')
    await engine.resume('reg-status')
    await engine.pause('reg-status')
    expect((await engine.inspect('reg-status')).status).toBe('paused')
  })
})
// Invariant assertions: [WS-08] [WS-17] [WS-18]
