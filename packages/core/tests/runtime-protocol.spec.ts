import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EventContractStore,
  InputLedgerStore,
  OperationLedgerStore,
  RegistrationRecordStore,
  RuntimeAuthorityStore,
  RuntimeEventStore,
  canonicalEventContract,
  eventContractDigest,
  parseOrchestrateRegistration,
  runtimeEventId,
  validateOperationBatch,
  validateOrchestrateResult,
  validatePayload,
  validateRegistrationRecord,
  type OrchestrateOperationBatch,
  type OrchestrateOperationSettlement,
  type OrchestrateRegistrationRecord,
  type RuntimeEventContract,
  type RuntimeEventRef,
} from '../src/index.ts'

// Invariant assertions: [WS-24] [WS-26]

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'worksurface-target-')); roots.push(value); return value }

describe('target Runtime protocol', () => {
  it('persists one authority and verifies content-addressed Contracts', async () => {
    const directory = await root()
    const authorities = new RuntimeAuthorityStore(directory)
    const authority = await authorities.init()
    expect(await authorities.init()).toEqual(authority)
    const store = new EventContractStore(join(directory, 'contracts'))
    const contract = canonicalEventContract({
      version: 1,
      scope: { authority: authority.id, kind: 'registration', id: 'delegate' },
      name: 'research.completed',
      description: 'Research result is ready.',
      subjects: ['surface'],
      producers: ['orchestrate', 'surface-session'],
      payloadSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['artifact'],
        properties: { artifact: { type: 'string', minLength: 1 } },
      },
    })
    const digest = await store.put(contract)
    expect(digest).toBe(eventContractDigest(contract))
    expect(await store.get(digest)).toEqual(contract)
    validatePayload(contract, { artifact: 'blocks/result.md' })
    expect(() => validatePayload(contract, { artifact: '' })).toThrow(/violates Event Contract/)

    const path = join(directory, 'contracts', 'sha256', `${digest.slice(7)}.json`)
    await writeFile(path, `${JSON.stringify({ ...contract, description: 'tampered' })}\n`)
    await expect(store.get(digest)).rejects.toThrow(/content-address verification/)
  })

  it('admits code-first Registration routes and rejects duplicate Surface bindings', () => {
    const source = parseOrchestrateRegistration({
      version: 1,
      registrationId: 'delegate',
      entrypoint: 'orchestrate.py',
      bindings: { coordinator: 'case-a', researcher: 'case-b' },
      events: {
        'research.requested': { file: 'contracts/requested.json', consumeFrom: ['coordinator'], surfaceOutputFrom: ['coordinator'] },
        'research.completed': { file: 'contracts/completed.json', consumeFrom: ['researcher'], surfaceOutputFrom: ['researcher'] },
      },
    })
    expect(source.entrypoint).toBe('orchestrate.py')
    expect(() => parseOrchestrateRegistration({ ...source, bindings: { coordinator: 'case-a', researcher: 'case-a' } })).toThrow(/multiple handles/)
    expect(() => parseOrchestrateRegistration({ ...source, entrypoint: '../escape.py' })).toThrow(/unsafe/)
  })

  it('stores authority-qualified Events and deduplicates Input Ledger EventRefs', async () => {
    const directory = await root()
    const authority = await new RuntimeAuthorityStore(directory).init()
    const contract = contractFor(authority.id)
    const digest = eventContractDigest(contract)
    const events = new RuntimeEventStore(join(directory, 'events'), authority.id)
    const operationKey = 'turn-1-result'
    const ref = await events.append('case-a', {
      id: runtimeEventId(authority.id, 'session-a/turn-1', operationKey, 'case-a'),
      type: { scope: contract.scope, name: contract.name, contract: digest },
      payload: { artifact: 'blocks/result.md' },
      causes: [],
      producer: { kind: 'surface-session', ref: 'session-a/turn-1' },
      operationKey,
    })
    expect(await events.replay('case-a')).toHaveLength(1)
    expect((await events.replay('case-a'))[0]?.subject.authority).toBe(authority.id)
    const inputs = new InputLedgerStore(join(directory, 'inputs'), authority.id)
    expect((await inputs.append('delegate', ref)).inputSeq).toBe(0)
    expect((await inputs.append('delegate', ref)).inputSeq).toBe(0)
    expect(await inputs.replay('delegate')).toHaveLength(1)
  })

  it('records recoverable Operation batches before settlements', async () => {
    const directory = await root()
    const authority = await new RuntimeAuthorityStore(directory).init()
    const contract = contractFor(authority.id)
    const digest = eventContractDigest(contract)
    const cause: RuntimeEventRef = { source: 'worksurface', subject: { authority: authority.id, kind: 'surface', id: 'case-a' }, seq: 0, id: 'evt-root' }
    const revision = `sha256:${'a'.repeat(64)}` as const
    const candidate = `sha256:${'b'.repeat(64)}` as const
    const batch: OrchestrateOperationBatch = {
      version: 1, authority: authority.id, registrationId: 'delegate', runId: 'run-0', orchestrateRevision: revision,
      triggerInputSeq: 0, causes: [cause], surfaces: { researcher: { surfaceId: 'case-b', baseRevision: revision, candidateRevision: candidate } },
      events: [{ surface: 'researcher', contract: { scope: contract.scope, name: contract.name, digest }, payload: { artifact: 'blocks/result.md' }, causes: [cause], operationKey: 'emit-result' }],
      advance: [], recordedAt: new Date().toISOString(),
    }
    validateOperationBatch(batch)
    const ledger = new OperationLedgerStore(join(directory, 'operations'), authority.id)
    await ledger.record(batch)
    expect(await ledger.pending()).toEqual([batch])
    const settlement: OrchestrateOperationSettlement = {
      version: 1, authority: authority.id, registrationId: 'delegate', runId: 'run-0',
      surfaceRevisions: { researcher: candidate }, events: [{ operationKey: 'emit-result', event: cause }], advance: [], settledAt: new Date().toISOString(),
    }
    await ledger.settle(settlement)
    expect(await ledger.pending()).toEqual([])
  })

  it('keeps Registration replay closed over exact artifacts, routes, and boundaries', async () => {
    const directory = await root()
    const authority = await new RuntimeAuthorityStore(directory).init()
    const contract = contractFor(authority.id)
    const record: OrchestrateRegistrationRecord = {
      version: 1,
      authority: authority.id,
      registrationId: 'delegate',
      orchestrateRevision: `sha256:${'a'.repeat(64)}`,
      entrypoint: 'orchestrate.py',
      surfaces: { coordinator: 'case-a', researcher: 'case-b' },
      routes: {
        [contract.name]: { scope: contract.scope, digest: eventContractDigest(contract), consumeFrom: ['coordinator'], surfaceOutputFrom: ['coordinator'] },
      },
      historyBoundary: {
        coordinator: { surfaceEventSeq: -1, dshEventSeq: -1 },
        researcher: { surfaceEventSeq: -1, dshEventSeq: -1 },
      },
    }
    validateRegistrationRecord(record)
    const registrations = new RegistrationRecordStore(join(directory, 'registrations'), authority.id)
    await registrations.put(record)
    expect(await registrations.get('delegate')).toEqual(record)
    await expect(registrations.put({ ...record, entrypoint: 'other.py' })).rejects.toThrow(/different facts/)

    validateOrchestrateResult({ version: 1, events: [], advance: [{ surface: 'researcher', instruction: 'Investigate.', outputs: [contract.name] }] }, record)
    expect(() => validateOrchestrateResult({ version: 1, events: [], advance: [{ surface: 'unknown', instruction: 'Investigate.', outputs: [] }] }, record)).toThrow(/unknown Surface/)
  })
})

function contractFor(authority: `wsa_${string}`): RuntimeEventContract {
  return canonicalEventContract({
    version: 1,
    scope: { authority, kind: 'registration', id: 'delegate' },
    name: 'research.completed',
    description: 'Research result is ready.',
    subjects: ['surface'],
    producers: ['surface-session'],
    payloadSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['artifact'],
      properties: { artifact: { type: 'string' } },
    },
  })
}
