import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { EventContractStore, FileWorkspace, InputLedgerStore, OperationLedgerStore, RegistrationRecordStore, RegistrationStatusStore, RevisionStore, RuntimeAuthorityStore, RuntimeEventStore, SURFACE_TEMPLATE, canonicalEventContract, eventContractDigest, runtimeEventId, runtimeRef, type OrchestrateOperationBatch } from '@pf-worksurface/core'
import { SurfaceContentRuntime } from '../src/surface-content-runtime.ts'
import { CodeFirstOrchestrator, type CodeFirstSurfacePort } from '../src/code-first-orchestrator.ts'
import type { OrchestrateCodeRunInput } from '../src/orchestrate-contract.ts'

// Invariant assertions: [WS-25] [WS-26]
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-content-runtime-')); roots.push(root)
  const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
  const authority = await new RuntimeAuthorityStore(join(root, 'runtime')).init()
  const store = new EventContractStore(join(root, 'contracts'))
  const events = new RuntimeEventStore(join(root, 'events'), authority.id, store)
  const contracts = Object.fromEntries(await Promise.all(['admitted', 'applied', 'published'].map(async name => {
    const contract = canonicalEventContract({ version: 1, scope: { authority: authority.id, kind: 'builtin', id: 'portable' }, name: `content.${name}`, description: name, subjects: ['surface'], producers: ['runtime'], payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { revision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } }, required: ['revision'] } })
    await store.put(contract); return [name, contract]
  }))) as unknown as ConstructorParameters<typeof SurfaceContentRuntime>[3]
  const workspace = new FileWorkspace(join(root, 'work'), join(root, 'workspace-state'), revisions)
  const surface = join(workspace.root, 'surfaces', 'a')
  await mkdir(surface, { recursive: true }); await writeFile(join(surface, 'surface.md'), SURFACE_TEMPLATE)
  const contentRoot = join(root, 'content')
  const operations = new OperationLedgerStore(join(root, 'operations'), authority.id)
  const runtime = new SurfaceContentRuntime(workspace, contentRoot, events, contracts, operations)
  const base = await runtime.head('a')
  const candidateDir = join(root, 'candidate'); await revisions.materialize(base, candidateDir)
  await writeFile(join(candidateDir, 'answer.txt'), 'candidate\n')
  const candidate = (await revisions.snapshotSurface(candidateDir)).revision
  const cause = runtimeRef((await events.replay('a'))[0]!)
  const batch: OrchestrateOperationBatch = { version: 1, authority: authority.id, registrationId: 'r', runId: 'run-1', orchestrateRevision: base, triggerInputSeq: 0, causes: [cause], surfaces: { target: { surfaceId: 'a', baseRevision: base, candidateRevision: candidate } }, events: [], advance: [], recordedAt: new Date().toISOString() }
  return { root, revisions, authority, store, events, contracts, workspace, surface, contentRoot, runtime, base, candidate, operations, batch }
}

it('uses portable contracts and preserves unpublished edits without admitting an apply intent', async () => {
  const f = await fixture()
  await writeFile(join(f.surface, 'draft.txt'), 'unpublished\n')
  await expect(f.runtime.apply('a', f.base, f.candidate, { registrationId: 'r', runId: '1', causes: [] })).rejects.toMatchObject({
    code: 'revision-conflict', message: expect.stringContaining(`Surface 'a' at '${f.surface}'`),
    details: { surfaceId: 'a', directory: f.surface, baseRevision: f.base, candidateRevision: f.candidate },
  })
  expect(await f.runtime.head('a')).toBe(f.base)
  expect(await readFile(join(f.surface, 'draft.txt'), 'utf8')).toBe('unpublished\n')
  expect((await readdir(f.contentRoot)).filter(name => name.endsWith('.json'))).toEqual([])
  expect(await f.events.replay('a')).toHaveLength(1)
})

it('recovers the durable apply after a file projection, retaining subsequent WIP and deduplicating replay', async () => {
  const f = await fixture()
  const append = f.events.append.bind(f.events)
  vi.spyOn(f.events, 'append').mockImplementationOnce(async () => { throw new Error('power loss before event append') })
  await expect(f.runtime.apply('a', f.base, f.candidate, { registrationId: 'r', runId: '1', causes: [] })).rejects.toThrow('power loss')
  expect(await readFile(join(f.surface, 'answer.txt'), 'utf8')).toBe('candidate\n')
  await writeFile(join(f.surface, 'draft.txt'), 'created after projection\n')
  vi.mocked(f.events.append).mockImplementation(append)
  const restarted = new SurfaceContentRuntime(new FileWorkspace(f.workspace.root, f.workspace.stateRoot, f.revisions), f.contentRoot, f.events, f.contracts, f.operations)
  await restarted.recover()
  await restarted.apply('a', f.base, f.candidate, { registrationId: 'r', runId: '1', causes: [] })
  expect(await restarted.head('a')).toBe(f.candidate)
  expect(await readFile(join(f.surface, 'draft.txt'), 'utf8')).toBe('created after projection\n')
  expect(await f.events.replay('a')).toHaveLength(2)
  expect((await readdir(f.contentRoot)).filter(name => name.endsWith('.json'))).toEqual([])
})

it('does not derive the head from another scope reusing the revision event name', async () => {
  const f = await fixture()
  const unrelated = canonicalEventContract({ ...f.contracts.applied, scope: { authority: f.authority.id, kind: 'registration', id: 'unrelated' }, producers: ['orchestrate'] })
  await f.store.put(unrelated)
  await f.events.append('a', { id: runtimeEventId(f.authority.id, 'foreign', 'same-name', 'a'), type: { name: unrelated.name, scope: unrelated.scope, contract: eventContractDigest(unrelated) }, payload: { revision: f.candidate }, causes: [], producer: { kind: 'orchestrate', ref: 'foreign' }, operationKey: 'same-name' })
  expect(await f.runtime.head('a')).toBe(f.base)
})

it('separates authoring from publication and rejects stale publication against a newer head', async () => {
  const f = await fixture()
  await writeFile(join(f.surface, 'first.txt'), 'first\n')
  const first = await f.runtime.publish('a', f.base, 'executor/1', 'publish', { summary: 'first' })
  const published = await f.runtime.head('a')
  await writeFile(join(f.surface, 'second.txt'), 'second\n')
  expect(await f.runtime.publish('a', published, 'executor/1', 'publish', { summary: 'first' })).toEqual(first)
  expect(await f.runtime.head('a')).toBe(published)
  await expect(f.runtime.publish('a', f.base, 'executor/2', 'publish', {})).rejects.toMatchObject({ code: 'revision-conflict' })
  expect(await readFile(join(f.surface, 'second.txt'), 'utf8')).toBe('second\n')
  expect((await f.events.replay('a')).map(event => event.type.name)).toEqual(['content.admitted', 'content.published'])
})

it('allows a no-content-change apply without overwriting or rejecting ordinary WIP', async () => {
  const f = await fixture()
  await writeFile(join(f.surface, 'draft.txt'), 'unpublished\n')
  const batch = { ...f.batch, surfaces: { target: { ...f.batch.surfaces.target!, candidateRevision: f.base } } }
  await f.runtime.recordBatch(batch, () => f.operations.record(batch))
  expect(await f.runtime.apply('a', f.base, f.base, { registrationId: 'r', runId: 'run-1', causes: batch.causes })).toBe(f.base)
  expect(await readFile(join(f.surface, 'draft.txt'), 'utf8')).toBe('unpublished\n')
  expect((await f.events.replay('a')).map(event => event.type.name)).toEqual(['content.admitted', 'content.applied'])
  expect((await readdir(f.contentRoot)).filter(name => name.endsWith('.json'))).toHaveLength(0)
})

it('reserves a checked base in the same workspace transaction that excludes publication', async () => {
  const f = await fixture()
  let ready!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { ready = resolve })
  const pause = new Promise<void>(resolve => { release = resolve })
  const recording = f.runtime.recordBatch(f.batch, async () => { ready(); await pause; await f.operations.record(f.batch) })
  await entered
  const publication = f.runtime.publish('a', f.base, 'executor/1', 'publish', {}).then(() => 'published', error => error.code as string)
  release(); await recording
  expect(await publication).toBe('revision-conflict')
  await expect(f.runtime.apply('a', f.base, f.candidate, { registrationId: 'foreign', runId: 'run-2', causes: [] })).rejects.toMatchObject({ code: 'revision-conflict' })
  await f.runtime.apply('a', f.base, f.candidate, { registrationId: 'r', runId: 'run-1', causes: f.batch.causes })
  expect(await f.runtime.head('a')).toBe(f.candidate)
})

it('does not record a batch whose head or authoring changed during its code run', async () => {
  const f = await fixture()
  await writeFile(join(f.surface, 'draft.txt'), 'unpublished\n')
  await expect(f.runtime.recordBatch(f.batch, () => f.operations.record(f.batch))).rejects.toMatchObject({ code: 'revision-conflict' })
  expect(await f.operations.pending()).toHaveLength(0)
  await f.runtime.publish('a', f.base, 'executor/1', 'publish', {})
  await expect(f.runtime.recordBatch(f.batch, () => f.operations.record(f.batch))).rejects.toMatchObject({ code: 'revision-conflict' })
  expect(await f.operations.pending()).toHaveLength(0)
})

it('diagnoses a blocked Surface and resumes its accepted input once after explicit draft publication', async () => {
  const f = await fixture()
  const report = join(f.workspace.root, 'surfaces', 'report')
  await f.revisions.materialize(f.base, report)
  await f.runtime.head('report')
  await writeFile(join(report, 'surface.md'), `${SURFACE_TEMPLATE}\nUnpublished report draft.\n`)
  const authoring = await f.workspace.observe('surfaces/report', 'surface')
  const registrations = new RegistrationRecordStore(join(f.root, 'registrations'), f.authority.id)
  const statuses = new RegistrationStatusStore(join(f.root, 'registration-status'), f.authority.id)
  const inputs = new InputLedgerStore(join(f.root, 'inputs'), f.authority.id)
  const code = join(f.root, 'code'); await mkdir(code); await writeFile(join(code, 'main.py'), '# test runner\n')
  const orchestrateRevision = (await f.revisions.snapshot(code, 'artifact')).revision
  await registrations.put({
    version: 1, authority: f.authority.id, registrationId: 'report-flow', orchestrateRevision, entrypoint: 'main.py',
    surfaces: { source: 'a', target: 'report' },
    routes: { [f.contracts.admitted.name]: { scope: f.contracts.admitted.scope, digest: eventContractDigest(f.contracts.admitted), consumeFrom: ['source'] } },
    historyBoundary: { source: { surfaceEventSeq: -1, externalEventSeq: -1 }, target: { surfaceEventSeq: -1, externalEventSeq: -1 } },
  })
  const advance = vi.fn<CodeFirstSurfacePort['advance']>(async () => ({ executionId: 'report-session', turnId: '1' }))
  const port: CodeFirstSurfacePort = {
    head: id => f.runtime.head(id), recordBatch: (batch, record) => f.runtime.recordBatch(batch, record),
    apply: (id, base, candidate, evidence) => f.runtime.apply(id, base, candidate, evidence),
    historyBoundary: async () => ({ surfaceEventSeq: -1, externalEventSeq: -1 }),
    resolveExternalInput: async () => { throw new Error('unexpected external input') },
    advance,
  }
  const run = vi.fn(async (input: OrchestrateCodeRunInput) => {
    const candidateDir = await mkdtemp(join(f.root, 'report-run-'))
    await f.revisions.materialize(input.baseRevisions.target!, candidateDir)
    await writeFile(join(candidateDir, 'answer.txt'), 'candidate\n')
    const candidate = (await f.revisions.snapshotSurface(candidateDir)).revision
    return { runId: 'report-run', candidates: { source: input.baseRevisions.source!, target: candidate }, result: { version: 1 as const, events: [], advance: [{ surface: 'target', instruction: 'Review the prepared report.', outputs: [] }] } }
  })
  const orchestrator = new CodeFirstOrchestrator(f.authority.id, f.revisions, f.store, f.events, registrations, statuses, inputs, f.operations, { run }, port)
  await orchestrator.init({ recover: false })
  await expect(orchestrator.accept((await f.events.replay('a'))[0]!)).rejects.toMatchObject({ code: 'effect-failed' })
  const failure = (await f.operations.failures('report-flow'))[0]!
  expect(failure).toMatchObject({ code: 'revision-conflict', phase: 'run' })
  for (const context of [`Surface 'report' at '${report}'`, `base ${f.base}`, `candidate ${f.candidate}`, `authoring ${authoring}`]) expect(failure.message).toContain(context)
  expect(await orchestrator.recover()).toMatchObject({ failedRegistrations: [{ registrationId: 'report-flow', code: 'revision-conflict', message: failure.message }] })
  expect(await f.operations.pending()).toHaveLength(0)
  expect(await f.runtime.head('report')).toBe(f.base)
  expect(await readFile(join(report, 'surface.md'), 'utf8')).toContain('Unpublished report draft.')
  const accepted = await inputs.replay('report-flow')
  expect(accepted).toHaveLength(1)
  expect(advance).not.toHaveBeenCalled()

  // The caller resolves the named draft explicitly; recovery reuses the accepted
  // upstream fact and rebuilds the candidate from the newly published target.
  await f.runtime.publish('report', f.base, 'report-editor/1', 'publish-report-draft', {})
  expect(await orchestrator.recover()).toMatchObject({ failedRegistrations: [] })
  expect(await readFile(join(report, 'answer.txt'), 'utf8')).toBe('candidate\n')
  expect(await readFile(join(report, 'surface.md'), 'utf8')).toContain('Unpublished report draft.')
  expect(await f.operations.pending()).toHaveLength(0)
  expect(await f.operations.recorded()).toHaveLength(1)
  expect(advance).toHaveBeenCalledTimes(1)
  expect(advance.mock.calls[0]?.[0]).toBe('report')
  const completedRuns = run.mock.calls.length
  const completedHead = await f.runtime.head('report')
  expect(await orchestrator.recover()).toMatchObject({ failedRegistrations: [] })
  expect(await inputs.replay('report-flow')).toEqual(accepted)
  expect(await f.runtime.head('report')).toBe(completedHead)
  expect(run).toHaveBeenCalledTimes(completedRuns)
  expect(advance).toHaveBeenCalledTimes(1)
})

it.each([null, [], { version: 1, surfaceId: 'a' }])('rejects malformed Surface apply journals as canonical corruption', async value => {
  const f = await fixture()
  await writeFile(join(f.contentRoot, 'bad.json'), JSON.stringify(value))
  await expect(f.runtime.recover()).rejects.toMatchObject({ code: 'canonical-corrupt' })
  expect(await f.runtime.recordedHead('a')).toBe(f.base)
})

it('does not reuse a committed workspace receipt for another authoring root', async () => {
  const f = await fixture()
  vi.spyOn(f.events, 'append').mockRejectedValueOnce(new Error('interrupted after projection'))
  await expect(f.runtime.apply('a', f.base, f.candidate, { registrationId: 'r', runId: '1', causes: [] })).rejects.toThrow('interrupted')
  const relocated = new FileWorkspace(join(f.root, 'other-authoring'), f.workspace.stateRoot, f.revisions)
  const restarted = new SurfaceContentRuntime(relocated, f.contentRoot, f.events, f.contracts, f.operations)
  await expect(restarted.recover()).rejects.toMatchObject({ code: 'invalid-working-copy' })
  expect(await f.runtime.recordedHead('a')).toBe(f.base)
  expect(await readFile(join(f.surface, 'answer.txt'), 'utf8')).toBe('candidate\n')
})

it('retains every exact Surface revision fact during forced collection of legacy unpinned history', async () => {
  const f = await fixture()
  await f.runtime.apply('a', f.base, f.candidate, { registrationId: 'r', runId: '1', causes: [] })
  await writeFile(join(f.surface, 'publication.txt'), 'later publication')
  await f.runtime.publish('a', f.candidate, 'executor/1', 'publish', {})
  const latest = await f.runtime.recordedHead('a')
  const roots = await f.runtime.revisionRoots()
  expect(roots).toEqual([f.base, f.candidate, latest].sort())
  for (const revision of await f.revisions.listPins()) await f.revisions.unpin(revision)
  const collected = await f.revisions.collect({ reachable: roots, minAgeMs: 0, now: Date.now() + 1_000 })
  for (const revision of roots) expect(collected.sweptRevisions).not.toContain(revision)
  const restarted = new SurfaceContentRuntime(f.workspace, f.contentRoot, f.events, f.contracts, f.operations)
  expect(await restarted.recordedHead('a')).toBe(latest)
  expect(await restarted.revisionRoots()).toEqual(roots)
})
