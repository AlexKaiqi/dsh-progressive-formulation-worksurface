import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import {
  RevisionStore,
  WorkSurfaceError,
  stableStringify,
  orchestrateRuntimeBinding,
  validateOrchestrateResult,
  type OrchestrateInputRecord,
  type OrchestrateRegistrationRecord,
  type OrchestrateResult,
  type OrchestrateRunState,
  type Revision,
  type RuntimeEventContract,
} from '@pf-worksurface/core'

const MAX_LOG_BYTES = 1024 * 1024
const TIMEOUT_MS = 30_000

export interface OrchestrateCodeRunInput {
  readonly registration: OrchestrateRegistrationRecord
  readonly triggerInputSeq: number
  readonly inputs: readonly OrchestrateInputRecord[]
  readonly baseRevisions: Readonly<Record<string, Revision>>
  readonly contracts: Readonly<Record<string, RuntimeEventContract>>
}
export interface OrchestrateCodeRunOutput {
  readonly runId: string
  readonly result: OrchestrateResult
  readonly candidates: Readonly<Record<string, Revision>>
}

/** Materializes the exact artifact and a disposable staged run view. */
export class SubprocessOrchestrateCodeRunner {
  constructor(private readonly ctx: Context, private readonly runtimeRoot: string, private readonly revisions: RevisionStore) {}

  async run(input: OrchestrateCodeRunInput): Promise<OrchestrateCodeRunOutput> {
    const runId = `run_${randomUUID().replaceAll('-', '')}`
    const invocationRoot = join(this.runtimeRoot, 'orchestrate-runs', runId)
    const artifactRoot = join(invocationRoot, 'artifact')
    const runRoot = join(invocationRoot, 'run')
    await mkdir(runRoot, { recursive: true, mode: 0o700 })
    try {
      const binding = orchestrateRuntimeBinding(input.registration, runId)
      await this.revisions.materialize(input.registration.orchestrateRevision, artifactRoot, { readOnly: true })
      const surfaces: Record<string, string> = {}
      for (const [handle, revision] of Object.entries(input.baseRevisions).sort(([a], [b]) => a.localeCompare(b))) {
        const relative = `surfaces/${handle}`
        surfaces[handle] = relative
        await this.revisions.materialize(revision, join(runRoot, relative))
      }
      const contractState: Record<string, { file: string; capabilities: ('consume' | 'orchestrate-emit' | 'surface-output')[] }> = {}
      for (const [name, contract] of Object.entries(input.contracts).sort(([a], [b]) => a.localeCompare(b))) {
        const file = `contracts/${name}.json`
        const resolved = binding.contracts[name]
        if (resolved === undefined) throw new WorkSurfaceError('canonical-corrupt', `Runtime Binding lacks route '${name}'`)
        const capabilities = [...resolved.capabilities]
        contractState[name] = { file, capabilities }
        await mkdir(join(runRoot, 'contracts'), { recursive: true, mode: 0o700 })
        await writeFile(join(runRoot, file), `${stableStringify(contract)}\n`, { flag: 'wx', mode: 0o400 })
      }
      const state: OrchestrateRunState = {
        version: 1,
        triggerInputSeq: input.triggerInputSeq,
        surfaces,
        contracts: contractState,
        files: { inputs: 'inputs.jsonl', result: 'result.json' },
      }
      await writeFile(join(runRoot, 'state.json'), `${stableStringify(state)}\n`, { flag: 'wx', mode: 0o400 })
      await writeFile(join(runRoot, 'inputs.jsonl'), input.inputs.map(record => stableStringify(record)).join('\n') + '\n', { flag: 'wx', mode: 0o400 })
      await this.execute(input.registration.entrypoint, artifactRoot, runRoot)
      let result: unknown
      try { result = JSON.parse(await readFile(join(runRoot, 'result.json'), 'utf8')) }
      catch (error) { if (error instanceof SyntaxError) throw new WorkSurfaceError('effect-failed', 'Orchestrate result.json is invalid JSON'); throw new WorkSurfaceError('effect-failed', 'Orchestrate code did not produce result.json') }
      validateOrchestrateResult(result, input.registration)
      const candidates: Record<string, Revision> = {}
      for (const handle of Object.keys(input.baseRevisions).sort()) candidates[handle] = (await this.revisions.snapshotSurface(join(runRoot, `surfaces/${handle}`))).revision
      return { runId, result, candidates }
    } finally {
      await this.revisions.removeMaterialization(artifactRoot).catch(() => undefined)
      await rm(invocationRoot, { recursive: true, force: true })
    }
  }

  private async execute(entrypoint: string, artifactRoot: string, runRoot: string): Promise<void> {
    const command = commandFor(entrypoint)
    const executable = await this.ctx.subprocess.resolveExecutable(command)
    const confined = this.ctx.sandbox.confine([executable, join(artifactRoot, entrypoint)], { mode: 'workspace-write', workspaceRoot: runRoot })
    if (confined.enforcement !== 'full') throw new WorkSurfaceError('unauthorized', 'Orchestrate code requires full filesystem enforcement')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Orchestrate code timed out')), TIMEOUT_MS)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: confined.argv,
        cwd: runRoot,
        stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_LOG_BYTES }, stderr: { maxBytes: MAX_LOG_BYTES } },
        graceMs: 1_000,
        signal: controller.signal,
        env: {},
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (stdout?.lossy === true || stderr?.lossy === true) throw new WorkSurfaceError('effect-failed', 'Orchestrate logs exceeded 1 MiB')
      if (controller.signal.aborted) throw new WorkSurfaceError('effect-failed', 'Orchestrate code timed out')
      if (outcome.exitCode !== 0) throw new WorkSurfaceError('effect-failed', `Orchestrate code exited with ${outcome.exitCode ?? outcome.signal}: ${stderr?.text ?? ''}`)
    } finally { clearTimeout(timeout) }
  }
}

function commandFor(path: string): 'python3' | 'node' | 'bash' | 'zsh' {
  switch (extname(path)) {
    case '.py': return 'python3'
    case '.js': case '.mjs': case '.cjs': return 'node'
    case '.sh': return 'bash'
    case '.zsh': return 'zsh'
    default: throw new WorkSurfaceError('invalid-definition', `Orchestrate entrypoint '${path}' has no supported interpreter`)
  }
}
