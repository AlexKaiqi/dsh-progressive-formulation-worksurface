import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EventContractStore,
  InputLedgerStore,
  OperationLedgerStore,
  RegistrationRecordStore,
  RevisionStore,
  RuntimeAuthorityStore,
  RuntimeEventStore,
  eventContractDigest,
  runtimeEventId,
  type Revision,
} from '@pf-worksurface/core'
import { CodeFirstOrchestrator, type CodeFirstSurfacePort } from '../src/code-first-orchestrator.ts'

// Invariant assertions: [WS-25] [WS-26]

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('code-first Orchestrate Runtime', () => {
  it('admits an exact artifact then records, applies, advances, and settles one input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-code-first-')); roots.push(root)
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authoring = join(root, 'work', 'orchestrations', 'delegate')
    const artifact = join(authoring, 'artifact')
    await mkdir(join(artifact, 'contracts'), { recursive: true })
    await writeFile(join(artifact, 'orchestrate.py'), '# fixed artifact\n')
    await writeFile(join(artifact, 'contracts', 'requested.json'), JSON.stringify(declaration('research.requested')))
    await writeFile(join(artifact, 'contracts', 'completed.json'), JSON.stringify(declaration('research.completed')))
    await writeFile(join(authoring, 'registration.json'), JSON.stringify({
      version: 1,
      registrationId: 'delegate',
      entrypoint: 'orchestrate.py',
      bindings: { coordinator: 'case-a', researcher: 'case-b' },
      events: {
        'research.requested': { file: 'contracts/requested.json', consumeFrom: ['coordinator'], surfaceOutputFrom: ['coordinator'] },
        'research.completed': { file: 'contracts/completed.json', consumeFrom: ['researcher'], surfaceOutputFrom: ['researcher'] },
      },
    }))
    const surfaceRoot = join(root, 'surfaces')
    const base: Record<string, Revision> = {}
    for (const id of ['case-a', 'case-b']) {
      const path = join(surfaceRoot, id); await mkdir(path, { recursive: true }); await writeFile(join(path, 'surface.md'), surfaceMarkdown(id)); base[id] = (await revisions.snapshotSurface(path)).revision
    }
    const authority = await new RuntimeAuthorityStore(join(root, 'v5')).init()
    const events = new RuntimeEventStore(join(root, 'v5', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'v5', 'contracts'))
    const registrations = new RegistrationRecordStore(join(root, 'v5', 'registrations'), authority.id)
    const inputs = new InputLedgerStore(join(root, 'v5', 'inputs'), authority.id)
    const operations = new OperationLedgerStore(join(root, 'v5', 'operations'), authority.id)
    const apply = vi.fn(async (_surface: string, _base: Revision, candidate: Revision) => candidate)
    const advance = vi.fn(async () => ({ sessionId: 'session-b', turnId: '1' }))
    const port: CodeFirstSurfacePort = {
      head: async surface => base[surface]!,
      historyBoundary: async () => ({ surfaceEventSeq: -1, dshEventSeq: -1 }),
      resolveDshInput: async () => { throw new Error('not used') },
      apply,
      advance,
    }
    const runner = { run: vi.fn(async (input: { baseRevisions: Readonly<Record<string, Revision>> }) => ({
      runId: 'run-1',
      result: { version: 1 as const, events: [], advance: [{ surface: 'researcher', instruction: 'Investigate.', outputs: ['research.completed'] }] },
      candidates: input.baseRevisions,
    })) }
    const orchestrator = new CodeFirstOrchestrator(authority.id, revisions, contracts, events, registrations, inputs, operations, runner as never, port, {})
    await orchestrator.init()
    const registration = await orchestrator.admit(join(authoring, 'registration.json'), artifact)
    const contract = await contracts.get(registration.routes['research.requested']!.digest)
    const event = await events.append('case-a', {
      id: runtimeEventId(authority.id, 'session-a/0', 'request', 'case-a'),
      type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) },
      payload: { value: 'question' }, causes: [], producer: { kind: 'surface-session', ref: 'session-a/0' }, operationKey: 'request',
    })
    expect(await orchestrator.admit(join(authoring, 'registration.json'), artifact)).toEqual(registration)
    const restarted = new CodeFirstOrchestrator(authority.id, revisions, contracts, events, registrations, inputs, operations, runner as never, port, {})
    await restarted.init()
    expect(runner.run).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledTimes(2)
    expect(advance).toHaveBeenCalledWith('case-b', 'Investigate.', expect.any(Array), [event], expect.any(String))
    expect(await operations.pending()).toEqual([])
  })
})

function declaration(name: string) { return { name, description: `${name} is ready.`, payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } } } }
function surfaceMarkdown(id: string): string { return `# Goal\n${id}\n\n# Acceptance Criteria\nDone.\n\n# Known Facts and Constraints\nNone.\n\n# Assumptions\nNone.\n\n# Open Questions\nNone.\n\n# Current Decisions\nNone.\n\n# Deliverables and Evidence\nNone.\n` }
