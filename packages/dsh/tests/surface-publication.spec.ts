import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  EventContractStore, FileEventStore, InputLedgerStore, OperationLedgerStore, RegistrationRecordStore, RegistrationStatusStore,
  RevisionStore, RuntimeAuthorityStore, RuntimeEventStore, SURFACE_TEMPLATE,
} from '@pf-worksurface/core'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeFirstOrchestrator } from '../src/code-first-orchestrator.ts'
import { DshCodeFirstSurfacePort } from '../src/code-first-surface-port.ts'
import { SurfaceSessionService } from '../src/session-surface.ts'
import { WorkSurfaceService } from '../src/service.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-publication-')); roots.push(root)
  const work = join(root, 'work'); const state = join(root, 'state'); const target = join(root, 'target')
  const authoring = join(work, 'surfaces', 'subject')
  await mkdir(authoring, { recursive: true }); await writeFile(join(authoring, 'surface.md'), SURFACE_TEMPLATE)
  const registrationRoot = join(work, 'orchestrations', 'review'); const artifact = join(registrationRoot, 'artifact')
  await mkdir(join(artifact, 'contracts'), { recursive: true })
  await writeFile(join(artifact, 'orchestrate.py'), '# No inputs are consumed in this publication test.\n')
  await writeFile(join(artifact, 'contracts', 'ready.json'), JSON.stringify({
    name: 'review.ready', description: 'review files are ready', payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
  }))
  await writeFile(join(registrationRoot, 'registration.json'), JSON.stringify({
    version: 1, registrationId: 'review', entrypoint: 'orchestrate.py', bindings: { subject: 'subject' },
    events: { 'review.ready': { file: 'contracts/ready.json', surfaceOutputFrom: ['subject'] } },
  }))
  const revisions = new RevisionStore(join(state, 'revisions')); const oldEvents = new FileEventStore(join(state, 'events'))
  await Promise.all([revisions.init(), oldEvents.init()])
  const authority = (await new RuntimeAuthorityStore(target).init()).id
  const contracts = new EventContractStore(join(target, 'contracts'))
  const events = new RuntimeEventStore(join(target, 'events'), authority, contracts)
  const surfaces = new SurfaceSessionService(oldEvents, revisions, work, state)
  const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined } } as never, work, target, revisions, events, contracts, surfaces)
  surfaces.registerRuntimeAuthority(authority); surfaces.registerRevisionHead(id => port.recordedHead(id)); await surfaces.init()
  const base = await port.head('subject')
  const codeFirst = new CodeFirstOrchestrator(authority, revisions, contracts, events,
    new RegistrationRecordStore(join(target, 'registrations'), authority),
    new RegistrationStatusStore(join(target, 'registration-status'), authority),
    new InputLedgerStore(join(target, 'inputs'), authority),
    new OperationLedgerStore(join(target, 'operations'), authority),
    { run: async () => { throw new Error('publication must not execute orchestration code') } }, port, {})
  await codeFirst.init(); await codeFirst.admit(join(registrationRoot, 'registration.json'), artifact)
  // Exercise the actual Service RPC methods with real scope, content, contracts,
  // and event stores; only Cordis startup and its unrelated UI adapters are absent.
  const service = Object.assign(Object.create(WorkSurfaceService.prototype) as WorkSurfaceService, {
    initialization: Promise.resolve(), surfaces, revisions, codeFirst, codeFirstEvents: events,
    codeFirstSurfacePort: port, config: { workRoot: work }, authoringFailures: new Map(),
  })
  const id = SessionId('publication-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: work })
  await surfaces.bindSession(session, 'subject', 'authoring')
  await surfaces.prepareFollowupBrief('subject', 'files-only', { instruction: 'Prepare files only.', outputs: [] })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { ...createUserMessage({ content: [{ type: 'text', text: 'Prepare files only.' }], source: { kind: 'user' } }), id: MessageId('files-only') }, { surfaceOp: 'append' })
  const capability = surfaces.beginTurn(session, 1)!
  const publish = (params: Record<string, unknown>) => service.dispatch({ id: 'request', method: 'surface.publish', params }, new AbortController().signal)
  return { service, surfaces, session, capability, port, authoring, base, revisions, events, publish }
}

describe('explicit Surface file publication', () => {
  it('publishes files with no business outputs and retries the same key without publishing later WIP', async () => {
    const { service, surfaces, session, capability, port, authoring, base, revisions, events, publish } = await fixture()
    const brief = JSON.parse(await readFile(join(surfaces.activeSurface(String(session.id))!.viewDir, 'turn-brief.json'), 'utf8'))
    expect(brief).toMatchObject({ version: 2, outputs: [], filePublication: {
      command: { argv: ['$DSH_WORKSURFACE_CLI', 'publish', '--key', '<stable-publication-key>'] },
    } })
    await expect(service.emitTurn(capability, 'review.ready', {})).rejects.toMatchObject({ code: 'unauthorized' })
    await writeFile(join(authoring, 'result.txt'), 'published result\n')
    const first = await publish({ capability, operationKey: 'result-v1', summary: 'Ready to read.' })
    const revision = await port.head('subject'); expect(revision).not.toBe(base)
    expect((await revisions.readFile(revision, 'result.txt')).toString()).toBe('published result\n')
    await writeFile(join(authoring, 'result.txt'), 'later unpublished work\n')
    await expect(publish({ capability, operationKey: 'result-v1', summary: 'Ready to read.' })).resolves.toEqual(first)
    await expect(service.emitTurn(capability, 'surface.revision.published', { summary: 'Ready to read.' }, 'result-v1')).resolves.toEqual(first)
    expect(await port.head('subject')).toBe(revision)
    expect(await readFile(join(authoring, 'result.txt'), 'utf8')).toBe('later unpublished work\n')
    await publish({ capability, operationKey: 'result-v2' })
    expect((await revisions.readFile(await port.head('subject'), 'result.txt')).toString()).toBe('later unpublished work\n')
    expect((await events.replay('subject')).filter(event => event.type.name === 'review.ready')).toEqual([])
    expect(surfaces.activeSurface(String(session.id))!.runtimeBinding!.contracts).toEqual({})
  })

  it('requires an active Turn and a nonblank key, validates summary, and rejects scope overrides', async () => {
    const { publish, capability, session, surfaces, base, port } = await fixture()
    for (const params of [
      { capability }, { capability, operationKey: '' }, { capability, operationKey: ' \t' },
      { capability, operationKey: 42 }, { capability, operationKey: 'good', summary: false },
      { capability, operationKey: 'good', surfaceId: 'other-surface' },
    ]) await expect(publish(params)).rejects.toMatchObject({ code: 'invalid-working-copy' })
    await expect(publish({ capability: 'ordinary-session', operationKey: 'good' })).rejects.toMatchObject({ code: 'unauthorized' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); surfaces.endTurn(String(session.id), 1)
    await expect(publish({ capability, operationKey: 'good' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(await port.head('subject')).toBe(base)
  })

  it('refuses a legacy private worktree instead of publishing different public files', async () => {
    const { service, surfaces, session, base, port, authoring, publish } = await fixture()
    const legacy = join(surfaces.stateRoot, 'surface-sessions', 'subject', 'work')
    await mkdir(legacy, { recursive: true }); await writeFile(join(legacy, 'result.txt'), 'private worktree draft\n')
    const resumed = Session.create(session.id, session.events, { ...session.header, cwd: legacy })
    const capability = surfaces.beginTurn(resumed, 1)!
    expect(surfaces.activeSurface(String(session.id))!.cwd).toBe(legacy)
    await expect(publish({ capability, operationKey: 'legacy' })).rejects.toMatchObject({ code: 'unauthorized', message: expect.stringContaining('private worktree') })
    await expect(service.emitTurn(capability, 'surface.revision.published', {}, 'legacy')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(await port.head('subject')).toBe(base)
    expect(await readFile(join(legacy, 'result.txt'), 'utf8')).toBe('private worktree draft\n')
    await expect(readFile(join(authoring, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
