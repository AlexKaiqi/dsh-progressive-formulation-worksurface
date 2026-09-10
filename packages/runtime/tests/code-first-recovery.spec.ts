import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventContractStore, InputLedgerStore, OperationLedgerStore, RegistrationRecordStore, RegistrationStatusStore, RevisionStore, RuntimeAuthorityStore, RuntimeEventStore, SURFACE_TEMPLATE, type OrchestrateRegistrationRecord, type Revision, type RuntimeEventEnvelope } from '@pf-worksurface/core'
import { CodeFirstOrchestrator, type CodeFirstSurfacePort } from '../src/code-first-orchestrator.ts'
import type { OrchestrateCodeRunInput } from '../src/orchestrate-contract.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-neutral-recovery-')); roots.push(root)
  const authority = (await new RuntimeAuthorityStore(root).init()).id
  const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
  const contracts = new EventContractStore(join(root, 'contracts'))
  const events = new RuntimeEventStore(join(root, 'events'), authority, contracts)
  const registrations = new RegistrationRecordStore(join(root, 'registrations'), authority)
  const statuses = new RegistrationStatusStore(join(root, 'registration-status'), authority)
  const inputs = new InputLedgerStore(join(root, 'inputs'), authority)
  const operations = new OperationLedgerStore(join(root, 'operations'), authority)
  const surfaceRoot = join(root, 'surface'); await mkdir(surfaceRoot); await writeFile(join(surfaceRoot, 'surface.md'), SURFACE_TEMPLATE)
  const revision = (await revisions.snapshotSurface(surfaceRoot)).revision
  const codeRoot = join(root, 'code'); await mkdir(codeRoot); await writeFile(join(codeRoot, 'main.py'), '# immutable Orchestrate code\n')
  const artifactRevision = (await revisions.snapshot(codeRoot, 'artifact')).revision
  const builtin = { description: 'Ready to continue.', exposure: 'orchestrate-input' as const, subjects: ['surface'] as const, producers: ['runtime'] as const, payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false } }
  const scope = { authority, kind: 'builtin' as const, id: 'worksurface' }
  const contract = { version: 1 as const, scope, name: 'work.ready', description: builtin.description, subjects: builtin.subjects, producers: builtin.producers, payloadSchema: builtin.payloadSchema }
  const digest = await contracts.put(contract)
  const port: CodeFirstSurfacePort = {
    head: async () => revision,
    historyBoundary: async () => ({ surfaceEventSeq: -1, externalEventSeq: -1 }),
    resolveExternalInput: async () => { throw new Error('external adapter not configured') },
    recordBatch: async (_batch, record) => record(),
    apply: vi.fn(async (_surface: string, _base: Revision, candidate: Revision) => candidate),
    advance: vi.fn(async () => ({ executionId: 'execution-1', turnId: 'turn-1' })),
  }
  const runner = { run: vi.fn(async (input: OrchestrateCodeRunInput) => ({ runId: `run-${input.registration.registrationId}-${input.triggerInputSeq}`, candidates: input.baseRevisions, result: { version: 1 as const, events: [], advance: [] } })) }
  const make = () => new CodeFirstOrchestrator(authority, revisions, contracts, events, registrations, statuses, inputs, operations, runner, port, { 'work.ready': builtin })
  const orchestrator = make(); await orchestrator.init()
  async function register(id = 'delegate', surfaceId = 'case-a') {
    const registration: OrchestrateRegistrationRecord = { version: 1, authority, registrationId: id, orchestrateRevision: artifactRevision, entrypoint: 'main.py', surfaces: { target: surfaceId }, routes: { 'work.ready': { scope, digest, consumeFrom: ['target'] } }, historyBoundary: { target: { surfaceEventSeq: -1, externalEventSeq: -1 } } }
    await registrations.put(registration)
    return registration
  }
  async function emit(surfaceId = 'case-a', suffix = '1'): Promise<RuntimeEventEnvelope> {
    const ref = await events.append(surfaceId, { id: `evt-${surfaceId}-${suffix}`, type: { scope, name: contract.name, contract: digest }, payload: {}, causes: [], producer: { kind: 'runtime', ref: 'fixture' }, operationKey: `ready-${suffix}` })
    return (await events.replay(surfaceId, ref.seq))[0]!
  }
  return { root, authority, revisions, contracts, events, registrations, statuses, inputs, operations, runner, port, revision, artifactRevision, codeRoot, orchestrator, make, register, emit, digest, scope }
}

describe('platform-neutral durable orchestration', () => {
  it('retries an accepted input after runner failure on duplicate delivery and exposes evidence', async () => {
    const f = await fixture(); await f.register()
    const event = await f.emit()
    f.runner.run.mockRejectedValueOnce(new Error('worker unavailable'))
    await expect(f.orchestrator.accept(event)).rejects.toThrow(/remain incomplete/)
    expect(await f.inputs.replay('delegate')).toHaveLength(1)
    expect((await f.orchestrator.inspectRegistrations())[0]).toMatchObject({ acceptedInputCount: 1, unfinishedInputCount: 1, failureCount: 1, lastFailure: { phase: 'run', message: 'worker unavailable' } })
    await f.orchestrator.accept(event)
    await f.orchestrator.accept(event)
    expect(f.runner.run).toHaveBeenCalledTimes(2)
    expect((await f.orchestrator.inspectRegistrations())[0]).toMatchObject({ recordedRunCount: 1, unfinishedInputCount: 0, failureCount: 1 })
  })

  it('settles a recorded batch as failed after an apply failure instead of retrying effects blindly', async () => {
    const f = await fixture(); await f.register(); const event = await f.emit()
    vi.mocked(f.port.apply).mockRejectedValueOnce(new Error('content adapter unavailable'))
    await expect(f.orchestrator.accept(event)).rejects.toThrow(/remain incomplete/)
    expect(await f.operations.pending()).toHaveLength(0)
    expect((await f.operations.failures())[0]).toMatchObject({ phase: 'apply', runId: 'run-delegate-0' })
    await f.make().init()
    expect(f.runner.run).toHaveBeenCalledOnce()
    expect(f.port.apply).toHaveBeenCalledOnce()
    expect(await f.operations.pending()).toHaveLength(0)
    expect((await f.orchestrator.inspectRegistrations())[0]).toMatchObject({ unfinishedInputCount: 0, failureCount: 1 })
  })

  it('keeps a retired Registration inactive across restart and makes retirement idempotent', async () => {
    const f = await fixture(); await f.register(); await f.orchestrator.accept(await f.emit())
    await f.orchestrator.retire('delegate')
    await f.orchestrator.retire('delegate')
    expect((await f.orchestrator.inspectRegistrations())[0]).toMatchObject({ registrationId: 'delegate', status: 'retired' })
    const restarted = f.make(); await restarted.init()
    await restarted.accept(await f.emit('case-a', 'after-retirement'))
    expect(f.runner.run).toHaveBeenCalledOnce()
    expect(await f.inputs.replay('delegate')).toHaveLength(1)
    expect((await restarted.inspectRegistrations())[0]).toMatchObject({ status: 'retired' })
  })

  it('recovers other registrations when one fails, and reports the incomplete one', async () => {
    const f = await fixture(); await f.register('broken', 'case-a'); await f.register('healthy', 'case-b')
    await f.emit('case-a'); await f.emit('case-b')
    const original = f.runner.run.getMockImplementation()!
    f.runner.run.mockImplementation(async input => { if (input.registration.registrationId === 'broken') throw new Error('broken runner'); return original(input) })
    expect(await f.orchestrator.recover()).toMatchObject({ failedRegistrations: [{ registrationId: 'broken', message: 'broken runner' }] })
    expect((await f.operations.recorded()).map(batch => batch.registrationId)).toEqual(['healthy'])
    expect((await f.orchestrator.inspectRegistrations()).find(row => row.registrationId === 'broken')).toMatchObject({ unfinishedInputCount: 1 })
  })

  it('does not make an unrelated delivery wait for a slow registration', async () => {
    const f = await fixture(); await f.register('slow', 'case-a'); await f.register('fast', 'case-b')
    const original = f.runner.run.getMockImplementation()!
    let resume!: () => void
    let entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    const pause = new Promise<void>(resolve => { resume = resolve })
    f.runner.run.mockImplementation(async input => { if (input.registration.registrationId === 'slow') { entered(); await pause }; return original(input) })
    const slow = f.orchestrator.accept(await f.emit('case-a'))
    await enteredPromise
    try {
      await f.orchestrator.accept(await f.emit('case-b'))
      expect((await f.operations.recorded()).map(batch => batch.registrationId)).toEqual(['fast'])
    } finally { resume(); await slow }
  })

  it.each(['emitOn', 'surfaceOutputFrom'])('rejects admission that grants %s for a runtime-only producer', async capability => {
    const f = await fixture()
    const artifact = join(f.root, 'artifact'); await mkdir(artifact); await writeFile(join(artifact, 'main.py'), '# noop\n')
    const file = join(f.root, 'registration.json')
    await writeFile(file, JSON.stringify({ version: 1, registrationId: 'forged', entrypoint: 'main.py', bindings: { target: 'case-a' }, events: { 'work.ready': { builtin: true, [capability]: ['target'] } } }))
    await expect(f.orchestrator.admit(file, artifact)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(await f.registrations.list()).toHaveLength(0)
  })

  it('explains how to repair a missing Event schema dialect and admits the corrected declaration', async () => {
    const f = await fixture()
    const declarationFile = join(f.codeRoot, 'ready.json')
    const declaration = { name: 'prep.ready', description: 'Preparation is complete.', payloadSchema: { type: 'object' } }
    const registrationFile = join(f.root, 'registration.json')
    await writeFile(declarationFile, JSON.stringify(declaration))
    await writeFile(registrationFile, JSON.stringify({ version: 1, registrationId: 'prep', entrypoint: 'main.py', bindings: { target: 'case-a' }, events: { 'prep.ready': { file: 'ready.json', surfaceOutputFrom: ['target'] } } }))
    await expect(f.orchestrator.admit(registrationFile, f.codeRoot)).rejects.toMatchObject({
      code: 'invalid-definition',
      message: 'Event declaration \'prep.ready\' in \'ready.json\': payloadSchema.$schema must equal "https://json-schema.org/draft/2020-12/schema"; set this field explicitly in payloadSchema',
      details: { eventName: 'prep.ready', path: 'ready.json', field: 'payloadSchema.$schema', expected: 'https://json-schema.org/draft/2020-12/schema' },
    })
    expect(await f.registrations.list()).toEqual([])
    await writeFile(declarationFile, JSON.stringify({ ...declaration, payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } }))
    expect(await f.orchestrator.admit(registrationFile, f.codeRoot)).toMatchObject({ registrationId: 'prep' })
  })

  it.each([
    { declaration: null, field: '$', expected: 'object' },
    { declaration: { name: 'other.ready', description: 'Ready.', payloadSchema: {} }, field: 'name', expected: 'prep.ready' },
    { declaration: { name: 'prep.ready', payloadSchema: {} }, field: 'description', expected: 'non-empty string' },
    { declaration: { name: 'prep.ready', description: 'Ready.', payloadSchema: [] }, field: 'payloadSchema', expected: 'object' },
    { declaration: { name: 'prep.ready', description: 'Ready.', payloadSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' } }, field: 'payloadSchema.$schema', expected: 'https://json-schema.org/draft/2020-12/schema' },
    { declaration: { name: 'prep.ready', description: 'Ready.', payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' } }, field: 'payloadSchema.type', expected: 'object' },
    { declaration: { name: 'prep.ready', description: 'Ready.', payloadSchema: {}, extra: true }, field: 'extra', expected: 'absent' },
  ])('reports the exact invalid declaration field $field without relaxing the contract', async ({ declaration, field, expected }) => {
    const f = await fixture()
    await writeFile(join(f.codeRoot, 'ready.json'), JSON.stringify(declaration))
    const registrationFile = join(f.root, 'registration.json')
    await writeFile(registrationFile, JSON.stringify({ version: 1, registrationId: 'prep', entrypoint: 'main.py', bindings: { target: 'case-a' }, events: { 'prep.ready': { file: 'ready.json', surfaceOutputFrom: ['target'] } } }))
    await expect(f.orchestrator.admit(registrationFile, f.codeRoot)).rejects.toMatchObject({ code: 'invalid-definition', details: { path: 'ready.json', field, expected } })
    expect(await f.registrations.list()).toEqual([])
  })

  it('rejects forged persisted effects before applying any Surface content', async () => {
    const f = await fixture(); await f.register(); const event = await f.emit()
    await f.inputs.append('delegate', { source: 'worksurface', subject: event.subject, seq: event.seq, id: event.id })
    const cause = (await f.inputs.replay('delegate'))[0]!.event
    await f.operations.record({ version: 1, authority: f.authority, registrationId: 'delegate', runId: 'forged-run', orchestrateRevision: f.artifactRevision, triggerInputSeq: 0, causes: [cause], surfaces: { target: { surfaceId: 'case-a', baseRevision: f.revision, candidateRevision: f.revision } }, events: [{ surface: 'target', contract: { scope: f.scope, name: 'work.ready', digest: f.digest }, payload: {}, causes: [cause], operationKey: 'forged-event' }], advance: [], recordedAt: new Date().toISOString() })
    expect(await f.orchestrator.recover()).toMatchObject({ failedRegistrations: [{ code: 'unauthorized' }] })
    expect(f.port.apply).not.toHaveBeenCalled()
    expect(await f.events.replay('case-a')).toHaveLength(1)
  })

  it('pins admitted immutable code before recording its Registration', async () => {
    const f = await fixture()
    const file = join(f.root, 'registration.json')
    await writeFile(file, JSON.stringify({ version: 1, registrationId: 'delegate', entrypoint: 'main.py', bindings: { target: 'case-a' }, events: { 'work.ready': { builtin: true, consumeFrom: ['target'] } } }))
    const put = f.registrations.put.bind(f.registrations)
    vi.spyOn(f.registrations, 'put').mockImplementation(async record => {
      expect(await f.revisions.listPins()).toContain(record.orchestrateRevision)
      await put(record)
    })
    await f.orchestrator.admit(file, f.codeRoot)
    await rm(f.codeRoot, { recursive: true })
    await f.revisions.collect({ reachable: [], minAgeMs: 0, now: Date.now() + 1_000 })
    expect((await f.revisions.readFile(f.artifactRevision, 'main.py')).toString()).toContain('immutable Orchestrate code')
  })

  it('keeps all recorded batch revisions across forced collection, including terminally failed records', async () => {
    const f = await fixture(); await f.register()
    const candidateRoot = join(f.root, 'candidate'); await f.revisions.materialize(f.revision, candidateRoot)
    await writeFile(join(candidateRoot, 'result.txt'), 'result produced before interruption')
    const candidate = (await f.revisions.snapshotSurface(candidateRoot)).revision
    f.runner.run.mockImplementationOnce(async () => ({ runId: 'run-delegate-0', candidates: { target: candidate }, result: { version: 1, events: [], advance: [] } }))
    const record = f.operations.record.bind(f.operations)
    vi.spyOn(f.operations, 'record').mockImplementation(async batch => {
      expect(await f.revisions.listPins()).toEqual(expect.arrayContaining([f.artifactRevision, f.revision, candidate]))
      await record(batch)
    })
    vi.mocked(f.port.apply).mockRejectedValueOnce(new Error('writer unavailable for a long time'))
    await expect(f.orchestrator.accept(await f.emit())).rejects.toMatchObject({ code: 'effect-failed' })
    expect(await f.operations.pending()).toHaveLength(0)
    const roots = await f.orchestrator.revisionRoots()
    expect(roots).toEqual([f.artifactRevision, f.revision, candidate].sort())
    for (const revision of await f.revisions.listPins()) await f.revisions.unpin(revision)
    const orphanRoot = join(f.root, 'orphan'); await mkdir(orphanRoot); await writeFile(join(orphanRoot, 'unrelated.txt'), 'orphan')
    const orphan = (await f.revisions.snapshot(orphanRoot, 'artifact')).revision
    await rm(f.codeRoot, { recursive: true }); await rm(candidateRoot, { recursive: true })
    const collected = await f.revisions.collect({ reachable: roots, minAgeMs: 0, now: Date.now() + 1_000 })
    expect(collected.sweptRevisions).toContain(orphan)
    for (const revision of roots) expect(collected.sweptRevisions).not.toContain(revision)
    expect((await f.revisions.readFile(candidate, 'result.txt')).toString()).toBe('result produced before interruption')
    await f.make().init()
    expect(await f.operations.pending()).toHaveLength(0)
    expect(f.runner.run).toHaveBeenCalledOnce()
  })
})
