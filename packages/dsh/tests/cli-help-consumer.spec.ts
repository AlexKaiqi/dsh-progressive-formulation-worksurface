import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EventContractStore, FileWorkspace, InputLedgerStore, OperationLedgerStore,
  RegistrationRecordStore, RegistrationStatusStore, RevisionStore, RuntimeAuthorityStore, RuntimeEventStore,
  SURFACE_TEMPLATE, eventContractDigest, type RuntimeEventRef,
} from '@pf-worksurface/core'
import { helpFor } from '../../cli/src/help.ts'
import { CodeFirstOrchestrator, type CodeFirstSurfacePort } from '../src/code-first-orchestrator.ts'
import { SubprocessOrchestrateCodeRunner } from '../src/orchestrate-code-runner.ts'

// Invariant assertions: [WS-20] [WS-25] [WS-26]
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('CLI coordination example consumed by the implementation', () => {
  it('admits the verbatim example, runs its Python against the real view, applies findings, and advances only once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-help-consumer-')); roots.push(root)
    const help = helpFor('coordinate')
    const section = (start: string, end: string): string => help.split(`${start}\n`)[1]!.split(`\n\n${end}`)[0]!
    const registrationText = section('registration.json:', 'artifact/contracts/research.ready.json:')
    const declarationText = section('artifact/contracts/research.ready.json:', 'artifact/orchestrate.py:')
    const code = section('artifact/orchestrate.py:', 'RUN VIEW AND OUTPUT RULES')
    const authoring = join(root, 'orchestration'), artifact = join(authoring, 'artifact')
    await mkdir(join(artifact, 'contracts'), { recursive: true })
    await writeFile(join(authoring, 'registration.json'), registrationText)
    await writeFile(join(artifact, 'contracts/research.ready.json'), declarationText)
    await writeFile(join(artifact, 'orchestrate.py'), code)
    const work = join(root, 'work')
    for (const id of ['research', 'report']) {
      await mkdir(join(work, 'surfaces', id), { recursive: true })
      await writeFile(join(work, 'surfaces', id, 'surface.md'), SURFACE_TEMPLATE)
    }
    const findings = 'Measured 360 July orders and 400 August orders. Source: fixed input.\n'
    await writeFile(join(work, 'surfaces/research/findings.md'), findings)
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const workspace = new FileWorkspace(work, join(root, 'workspace-state'), revisions)
    const authority = (await new RuntimeAuthorityStore(join(root, 'runtime')).init()).id
    const contracts = new EventContractStore(join(root, 'contracts'))
    const events = new RuntimeEventStore(join(root, 'events'), authority, contracts)
    const registrations = new RegistrationRecordStore(join(root, 'registrations'), authority)
    const statuses = new RegistrationStatusStore(join(root, 'registration-status'), authority)
    const inputs = new InputLedgerStore(join(root, 'inputs'), authority)
    const operations = new OperationLedgerStore(join(root, 'operations'), authority)
    const advances: { surface: string; instruction: string; causes: readonly RuntimeEventRef[] }[] = []
    const surfaces: CodeFirstSurfacePort = {
      head: id => workspace.snapshot(`surfaces/${id}`, 'surface'),
      historyBoundary: async id => ({ surfaceEventSeq: (await events.replay(id)).length - 1, externalEventSeq: -1 }),
      resolveExternalInput: async () => { throw new Error('No external input in this example') },
      recordBatch: async (_batch, record) => record(),
      apply: async (id, base, candidate, evidence) => {
        await workspace.transaction(view => view.replace(`surfaces/${id}`, base, candidate, `${evidence.runId}/${id}`))
        return candidate
      },
      advance: async (surface, instruction, _outputs, causes) => {
        advances.push({ surface, instruction, causes })
        return { executionId: 'test-host-report', turnId: '1' }
      },
    }
    // This fixture tests the real view builder, Python, result validator, and
    // stores. It supplies a local process port; native confinement is tested
    // separately by the host and is not claimed by this example test.
    const context = {
      sandbox: { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) },
      subprocess: {
        resolveExecutable: async () => {
          const process = localProcess(['/usr/bin/which', 'python3'], root)
          expect((await process.done).exitCode).toBe(0)
          return process.collected.stdout.readFrom().text.trim()
        },
        spawn: ({ argv, cwd, signal }: { argv: string[]; cwd: string; signal: AbortSignal }) => localProcess(argv, cwd, signal),
      },
    }
    const runner = new SubprocessOrchestrateCodeRunner(context as never, join(root, 'runs'), revisions)
    const runtime = new CodeFirstOrchestrator(authority, revisions, contracts, events, registrations, statuses, inputs, operations, runner, surfaces, {})
    await runtime.init()
    const registration = await runtime.admit(join(authoring, 'registration.json'), artifact)
    const contract = await contracts.get(registration.routes['research.ready']!.digest)
    const ref = await events.append('research', {
      id: 'research-ready-1', type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) },
      payload: { summary: 'Findings independently checked.' }, causes: [],
      producer: { kind: 'surface-session', ref: 'test-host-research/1' }, operationKey: 'research-ready',
    })
    const event = (await events.replay('research', ref.seq))[0]!
    await runtime.accept(event)
    await runtime.accept(event)
    expect(await readFile(join(work, 'surfaces/report/research.md'), 'utf8')).toBe(findings)
    expect(advances).toEqual([{ surface: 'report', instruction: "Read research.md and surface.md. Produce and verify report.md against the report's acceptance criteria.", causes: [ref] }])
    expect(await operations.pending()).toEqual([])
    expect(await operations.recorded()).toHaveLength(1)
  })
})

function localProcess(argv: string[], cwd: string, signal?: AbortSignal) {
  const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], signal })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  return {
    done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    }),
    collected: {
      stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
    },
  }
}
