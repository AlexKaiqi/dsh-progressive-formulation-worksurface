import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import { RevisionStore, WorkSurfaceError, assertJson } from '@pf-worksurface/core'
import type { CodeHandlerEmit, CodeHandlerRunner } from '@pf-worksurface/runtime'

const MAX_OUTPUT_BYTES = 1024 * 1024
const HANDLER_TIMEOUT_MS = 30_000

/** Executes handler code from an exact read-only Definition revision. */
export class SubprocessCodeHandlerRunner implements CodeHandlerRunner {
  constructor(
    private readonly ctx: Context,
    private readonly runtimeRoot: string,
    private readonly revisions: RevisionStore,
  ) {}

  async run(input: Parameters<CodeHandlerRunner['run']>[0]): Promise<readonly CodeHandlerEmit[]> {
    const invocationRoot = join(this.runtimeRoot, 'handlers', randomUUID())
    const definitionRoot = join(invocationRoot, 'definition')
    const writableRoot = join(invocationRoot, 'runtime')
    const binRoot = join(writableRoot, 'bin')
    const contextFile = join(invocationRoot, 'context.json')
    const outputFile = join(writableRoot, 'emits.jsonl')
    await mkdir(binRoot, { recursive: true, mode: 0o700 })
    try {
      await this.revisions.materialize(input.registration.definitionRevision, definitionRoot, { readOnly: true })
      await writeFile(contextFile, `${JSON.stringify({
        version: 1,
        registration: input.registration,
        activation: input.activation,
        matches: input.matches,
        bindings: input.bindings,
      })}\n`, { flag: 'wx', mode: 0o400 })
      const wrapper = join(binRoot, 'ws')
      await writeFile(wrapper, WS_WRAPPER, { flag: 'wx', mode: 0o700 })
      await chmod(wrapper, 0o700)
      const executable = await this.ctx.subprocess.resolveExecutable(input.handler.command)
      const program = join(definitionRoot, input.handler.path)
      const confined = this.ctx.sandbox.confine([executable, program, ...(input.handler.args ?? [])], {
        mode: 'workspace-write',
        workspaceRoot: writableRoot,
      })
      if (confined.enforcement !== 'full') throw new WorkSurfaceError('unauthorized', 'handler requires full filesystem enforcement')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('handler timed out')), HANDLER_TIMEOUT_MS)
      try {
        const handle = this.ctx.subprocess.spawn({
          argv: confined.argv,
          cwd: definitionRoot,
          stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_OUTPUT_BYTES } },
          graceMs: 1000,
          signal: controller.signal,
          env: {
            PATH: `${binRoot}${delimiter}${process.env.PATH ?? ''}`,
            DSH_CONTEXT_FILE: contextFile,
            WS_HANDLER_OUTPUT: outputFile,
          },
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        if (stdout?.lossy === true || stderr?.lossy === true) throw new WorkSurfaceError('effect-failed', 'handler logs exceeded 1 MiB')
        if (controller.signal.aborted) throw new WorkSurfaceError('effect-failed', 'handler timed out')
        if (outcome.exitCode !== 0) throw new WorkSurfaceError('effect-failed', `handler exited with ${outcome.exitCode ?? outcome.signal}: ${stderr?.text ?? ''}`)
        return this.readEmits(outputFile, input.bindings, input.handler.emits)
      } finally {
        clearTimeout(timeout)
      }
    } finally {
      await this.revisions.removeMaterialization(definitionRoot).catch(() => undefined)
      await rm(invocationRoot, { recursive: true, force: true })
    }
  }

  private async readEmits(
    outputFile: string,
    bindings: Readonly<Record<string, string>>,
    allowedRoles: readonly string[],
  ): Promise<readonly CodeHandlerEmit[]> {
    let content = ''
    try { content = await readFile(outputFile, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (Buffer.byteLength(content) > MAX_OUTPUT_BYTES) throw new WorkSurfaceError('effect-failed', 'handler emitted more than 1 MiB')
    const roleBySurface = new Map(Object.entries(bindings).map(([role, surface]) => [surface, role]))
    return content.split('\n').filter(Boolean).map((line, index) => {
      let value: unknown
      try { value = JSON.parse(line) }
      catch { throw new WorkSurfaceError('effect-failed', `handler emission ${index} is invalid JSON`) }
      if (!record(value)) throw new WorkSurfaceError('effect-failed', `handler emission ${index} must be an object`)
      const role = typeof value.surface === 'string' ? roleBySurface.get(value.surface) : undefined
      if (role === undefined || !allowedRoles.includes(role)) throw new WorkSurfaceError('unauthorized', `handler emission ${index} targets an undeclared Surface`)
      if (typeof value.name !== 'string' || value.name === '') throw new WorkSurfaceError('effect-failed', `handler emission ${index} has no event name`)
      if (typeof value.operationKey !== 'string' || value.operationKey === '') throw new WorkSurfaceError('effect-failed', `handler emission ${index} requires a stable operation key`)
      assertJson(value.payload, `handler emission ${index} payload`)
      return { targetRole: role, name: value.name, payload: value.payload, operationKey: value.operationKey }
    })
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const WS_WRAPPER = `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args[0] !== 'emit' || !args[1]) { console.error('usage: ws emit <event> --surface <id> --key <key> --payload <json>'); process.exit(2); }
const get = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const surface = get('--surface');
const operationKey = get('--key');
const payloadText = get('--payload') ?? 'null';
if (!surface || !operationKey) { console.error('--surface and --key are required in a handler'); process.exit(2); }
let payload;
try { payload = JSON.parse(payloadText); } catch { console.error('--payload must be JSON'); process.exit(2); }
fs.appendFileSync(process.env.WS_HANDLER_OUTPUT, JSON.stringify({ surface, operationKey, name: args[1], payload }) + '\\n', { mode: 0o600 });
`
