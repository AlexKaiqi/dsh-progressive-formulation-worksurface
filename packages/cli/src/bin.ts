#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { asWorkSurfaceError, WorkSurfaceError } from '@pf-worksurface/core'
import { WorkSurfaceHostClient } from './client.ts'
import { executeDirect } from './direct.ts'
import type { WorkSurfaceRpcMethod } from './protocol.ts'

const VERSION = '0.1.0-rc.5'

interface ParsedArgs {
  readonly flags: ReadonlyMap<string, string | true>
  readonly positional: readonly string[]
}

interface Command {
  readonly method: WorkSurfaceRpcMethod
  readonly params: Readonly<Record<string, unknown>>
  readonly json: boolean
  readonly resultPath?: string
}

const HELP = `Usage: ws <command> [arguments] [options]

Commands:
  ws new --from <template> --key <key> [--parent <surface>] [--surface <id>]
  ws checkout <surface> <target> [--revision <revision>]
  ws commit <working-copy> --base <revision> --key <key> [--retry]
  ws show <surface> [--revision <revision>] [--projection --profile <name>]
  ws agent run --surface <surface> --task <text> --profile <name> --key <key> --result <path>
  ws help init

Global options:
  --attempt <id>       Override WS_ATTEMPT_ID.
  --json               Emit one JSON value on stdout.
  --help               Show command help.
  --version            Show CLI version.

Effect commands require a stable idempotency key. Inside an Orchestrator,
the CLI reaches the Host through WS_HOST_SOCKET and never opens canonical state.
`

const INIT_HELP = `PF WorkSurface initialization

Use a WorkSurface for complex, multi-stage work that benefits from durable
decisions, resumption, review, evidence, or independently delegated outputs.
Do not use it only to restate a simple answer or a bounded one-step file change.

Initialize the root before delegation:
  1. Checkout WS_ROOT_SURFACE to a fresh path inside WS_ATTEMPT_DIR, for example
     WS_ATTEMPT_DIR/work/root. Paths outside the attempt directory are rejected.
     Retain the returned revision as the commit base.
  2. Record the goal, acceptance criteria, known facts and constraints,
     assumptions, open questions, current decisions, and expected deliverables.
  3. Keep surface.md as the current state index. Put substantial evidence and
     deliverables in blocks/<block-id>.md and reference them from surface.md.
  4. Keep existing runtime-owned identity front matter unchanged. A new Block
     needs this minimum front matter, with values matching its path and Surface:

       ---
       block_id: <block-id>
       surface_id: <surface-id>
       kind: <task-relevant-kind>
       status: active
       ---

     Reference it as [[block:<surface-id>/<block-id>]].
  5. Mark superseded content explicitly; do not present assumptions as facts or
     preserve hidden reasoning.
  6. Commit the complete working copy with the exact base revision and a stable key.

Create a child Surface only for an independently owned deliverable with its own
goal, revision, completion evidence, and retry lifecycle. Parent Surfaces should
reference accepted child outputs instead of copying the child's work history.
`

/**
 * Run the CLI and return its process exit code.
 * @param argv - Command arguments without the executable name.
 * @param env - Environment used to locate the Host or direct store.
 * @returns The stable process exit code.
 */
export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || (argv[0] === 'help' && argv.length === 1)) {
    process.stdout.write(HELP)
    return 0
  }
  if (argv.length === 2 && argv[0] === 'help' && argv[1] === 'init') {
    process.stdout.write(INIT_HELP)
    return 0
  }
  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  let command: Command | undefined
  try {
    command = parseCommand(argv)
    const parsed = parseArgs(command.method === 'agent.run' ? argv.slice(2) : argv.slice(1))
    const attemptId = option(parsed, 'attempt') ?? env.WS_ATTEMPT_ID ?? env.DSH_WS_ATTEMPT_ID ?? 'adhoc'
    const controller = new AbortController()
    const abort = (): void => {
      controller.abort(new WorkSurfaceError('effect-failed', 'operation cancelled'))
    }
    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)
    try {
      const result = await execute(command, attemptId, env, controller.signal)
      if (command.resultPath !== undefined) {
        await writeFileAtomic(command.resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      }
      renderSuccess(command, result)
      return 0
    } finally {
      process.removeListener('SIGINT', abort)
      process.removeListener('SIGTERM', abort)
    }
  } catch (error) {
    const stable = asWorkSurfaceError(error)
    const json = command?.json ?? argv.includes('--json')
    if (json) {
      process.stderr.write(`${JSON.stringify({ error: { code: stable.code, message: stable.message, details: stable.details } })}\n`)
    } else {
      process.stderr.write(`ws: ${stable.code}: ${stable.message}\n`)
    }
    return exitCode(stable)
  }
}

async function execute(command: Command, attemptId: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<unknown> {
  const socketPath = env.WS_HOST_SOCKET ?? env.DSH_WS_HOST_SOCKET
  const attemptToken = env.WS_ATTEMPT_TOKEN ?? env.DSH_WS_ATTEMPT_TOKEN
  if (socketPath !== undefined) {
    if (!attemptToken) throw new WorkSurfaceError('unauthorized', 'WorkSurface attempt token is required with the Host socket')
    return new WorkSurfaceHostClient({
      socketPath,
      attemptId,
      token: attemptToken,
    }).call(command.method, command.params, signal)
  }
  if (env.WS_ATTEMPT_DIR !== undefined || env.DSH_WS_ATTEMPT_DIR !== undefined) {
    throw new WorkSurfaceError('unauthorized', 'an Orchestrator process cannot fall back to direct canonical-store access')
  }
  if (!env.WS_STORE_ROOT) throw new WorkSurfaceError('unauthorized', 'WS_STORE_ROOT is required for direct file commands')
  return executeDirect(env.WS_STORE_ROOT, command.method, attemptId, command.params)
}

function parseCommand(argv: readonly string[]): Command {
  if (argv[0] === 'agent') {
    if (argv[1] !== 'run') throw usage('expected ws agent run')
    const parsed = parseArgs(argv.slice(2))
    validateFlags(parsed, ['attempt', 'json', 'key', 'profile', 'result', 'retry', 'surface', 'task'])
    requirePositionals(parsed, 0)
    return {
      method: 'agent.run',
      json: flag(parsed, 'json'),
      resultPath: requiredOption(parsed, 'result'),
      params: {
        surface: requiredOption(parsed, 'surface'),
        task: requiredOption(parsed, 'task'),
        profile: requiredOption(parsed, 'profile'),
        key: requiredOption(parsed, 'key'),
        ...(flag(parsed, 'retry') ? { retry: true } : {}),
      },
    }
  }
  const parsed = parseArgs(argv.slice(1))
  switch (argv[0]) {
    case 'new':
      validateFlags(parsed, ['attempt', 'from', 'json', 'key', 'parent', 'retry', 'surface'])
      requirePositionals(parsed, 0)
      return {
        method: 'new',
        json: flag(parsed, 'json'),
        params: {
          templatePath: requiredOption(parsed, 'from'),
          key: requiredOption(parsed, 'key'),
          ...option(parsed, 'parent') === undefined ? {} : { parent: option(parsed, 'parent') },
          ...option(parsed, 'surface') === undefined ? {} : { surface: option(parsed, 'surface') },
          ...(flag(parsed, 'retry') ? { retry: true } : {}),
        },
      }
    case 'checkout':
      validateFlags(parsed, ['attempt', 'json', 'revision'])
      requirePositionals(parsed, 2)
      return {
        method: 'checkout',
        json: flag(parsed, 'json'),
        params: {
          surface: positional(parsed, 0),
          targetPath: positional(parsed, 1),
          ...option(parsed, 'revision') === undefined ? {} : { revision: option(parsed, 'revision') },
        },
      }
    case 'commit':
      validateFlags(parsed, ['attempt', 'base', 'json', 'key', 'retry'])
      requirePositionals(parsed, 1)
      return {
        method: 'commit',
        json: flag(parsed, 'json'),
        params: {
          workingPath: positional(parsed, 0),
          baseRevision: requiredOption(parsed, 'base'),
          key: requiredOption(parsed, 'key'),
          ...(flag(parsed, 'retry') ? { retry: true } : {}),
        },
      }
    case 'show': {
      validateFlags(parsed, ['attempt', 'json', 'profile', 'projection', 'revision', 'token-budget'])
      requirePositionals(parsed, 1)
      if (flag(parsed, 'projection')) {
        const budget = Number.parseInt(option(parsed, 'token-budget') ?? '40000', 10)
        if (!Number.isSafeInteger(budget) || budget <= 0) throw usage('--token-budget must be a positive integer')
        return {
          method: 'projection',
          json: flag(parsed, 'json'),
          params: {
            surface: positional(parsed, 0),
            profile: option(parsed, 'profile') ?? 'default',
            tokenBudget: budget,
            ...option(parsed, 'revision') === undefined ? {} : { revision: option(parsed, 'revision') },
          },
        }
      }
      if (option(parsed, 'profile') !== undefined || option(parsed, 'token-budget') !== undefined) {
        throw usage('--profile and --token-budget require --projection')
      }
      return {
        method: 'show',
        json: flag(parsed, 'json'),
        params: {
          surface: positional(parsed, 0),
          ...option(parsed, 'revision') === undefined ? {} : { revision: option(parsed, 'revision') },
        },
      }
    }
    default:
      throw usage(`unknown command '${argv[0] ?? ''}'`)
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  let positionalOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) break
    if (positionalOnly) {
      positional.push(token)
      continue
    }
    if (token === '--') {
      positionalOnly = true
      continue
    }
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const name = token.slice(2, equals < 0 ? undefined : equals)
    if (name === '') throw usage('empty option name')
    if (flags.has(name)) throw usage(`option --${name} was provided more than once`)
    if (equals >= 0) {
      const value = token.slice(equals + 1)
      if (value === '') throw usage(`option --${name} requires a value`)
      flags.set(name, value)
      continue
    }
    if (['json', 'projection', 'retry'].includes(name)) {
      flags.set(name, true)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw usage(`option --${name} requires a value`)
    flags.set(name, value)
    index += 1
  }
  return { flags, positional }
}

function validateFlags(parsed: ParsedArgs, allowed: readonly string[]): void {
  const permit = new Set(allowed)
  for (const name of parsed.flags.keys()) if (!permit.has(name)) throw usage(`unknown option --${name}`)
}

function requirePositionals(parsed: ParsedArgs, count: number): void {
  if (parsed.positional.length !== count) throw usage(`expected ${count} positional argument${count === 1 ? '' : 's'}`)
}

function positional(parsed: ParsedArgs, index: number): string {
  const value = parsed.positional[index]
  if (value === undefined) throw usage(`missing positional argument ${index + 1}`)
  return value
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = option(parsed, name)
  if (value === undefined) throw usage(`missing required option --${name}`)
  return value
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)
  if (value === true) throw usage(`option --${name} requires a value`)
  return value
}

function flag(parsed: ParsedArgs, name: string): boolean {
  const value = parsed.flags.get(name)
  if (typeof value === 'string') throw usage(`option --${name} does not take a value`)
  return value === true
}

function usage(message: string): WorkSurfaceError {
  return new WorkSurfaceError('invalid-working-copy', `${message}; run 'ws --help'`)
}

function renderSuccess(command: Command, result: unknown): void {
  if (command.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  if (command.method === 'projection' && isRecord(result) && typeof result.renderedContent === 'string') {
    process.stdout.write(result.renderedContent)
    if (!result.renderedContent.endsWith('\n')) process.stdout.write('\n')
    return
  }
  if (command.method === 'show' && isRecord(result) && typeof result.surfaceDocument === 'string') {
    process.stdout.write(result.surfaceDocument)
    if (!result.surfaceDocument.endsWith('\n')) process.stdout.write('\n')
    return
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exitCode(error: WorkSurfaceError): number {
  switch (error.code) {
    case 'not-found': return 10
    case 'revision-conflict': return 11
    case 'dangling-reference':
    case 'invalid-id':
    case 'invalid-markdown-envelope':
    case 'invalid-reference':
    case 'invalid-working-copy':
    case 'block-header-mismatch':
    case 'physical-delete-forbidden':
    case 'target-not-empty': return 12
    case 'idempotency-key-conflict': return 13
    case 'unauthorized': return 14
    default: return 15
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main()
}
