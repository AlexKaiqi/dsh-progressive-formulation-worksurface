#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { asWorkSurfaceError, sha256, WorkSurfaceError } from '@pf-worksurface/core'
import { WorkSurfaceHostClient } from './client.ts'
import { HELP, VERSION, helpFor } from './help.ts'

interface Args { readonly flags: Map<string, string | true>; readonly positional: readonly string[] }

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write(HELP); return 0 }
  if (argv.length === 1 && argv[0] === '--version') { process.stdout.write(`${VERSION}\n`); return 0 }
  if (argv[0] === 'help') {
    if (argv.length > 2) { process.stderr.write(helpFor(argv[1])); return 15 }
    const output = helpFor(argv[1])
    if (argv[1] !== undefined && output.startsWith('Unknown WorkSurface help topic')) { process.stderr.write(output); return 15 }
    process.stdout.write(output)
    return 0
  }
  try {
    const result = await execute(parseArgs(argv), env)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    const stable = asWorkSurfaceError(error)
    process.stderr.write(`${JSON.stringify({ error: { code: stable.code, message: stable.message, details: stable.details } })}\n`)
    return stable.code === 'not-found' ? 10 : stable.code === 'unauthorized' ? 14 : stable.code === 'invalid-definition' ? 12 : 15
  }
}

async function execute(args: Args, env: NodeJS.ProcessEnv): Promise<unknown> {
  if (args.positional[0] === 'emit' && args.positional.length === 2) return emit(args, env)
  throw usage('expected `ws emit`')
}

async function emit(args: Args, env: NodeJS.ProcessEnv): Promise<unknown> {
  allowFlags(args, ['surface', 'key', 'payload', 'payload-file', 'socket', 'capability'])
  const target = args.positional[1]!
  const surfaceId = stringFlag(args, 'surface') ?? env.DSH_SURFACE_ID
  const runtime = turnRuntime(env)
  const client = clientFor(args, env, runtime?.socketPath)
  const capability = stringFlag(args, 'capability') ?? runtime?.capability ?? env.DSH_WORKSURFACE_CAPABILITY
  const operationKey = stringFlag(args, 'key')
  const value = parseJson(payload(args), 'payload')
  if (capability !== undefined) {
    return client.call('event.emit-turn', {
      capability, name: target, payload: value,
      ...(operationKey === undefined ? {} : { operationKey }),
    })
  }
  if (surfaceId === undefined) throw new WorkSurfaceError('unauthorized', '--surface is required outside a managed DSH Turn')
  const eventId = operationKey === undefined
    ? `evt_${randomUUID()}`
    : `evt_${sha256(`${surfaceId}\0${target}\0${operationKey}`).slice(0, 40)}`
  return client.call('event.emit', { surfaceId, name: target, payload: value, eventId })
}

function clientFor(args: Args, env: NodeJS.ProcessEnv, turnSocket?: string): WorkSurfaceHostClient {
  const socket = stringFlag(args, 'socket') ?? turnSocket ?? env.DSH_WORKSURFACE_SOCKET
  if (socket === undefined) throw new WorkSurfaceError('unauthorized', '--socket is required outside a managed DSH Turn')
  return new WorkSurfaceHostClient(socket)
}

function turnRuntime(env: NodeJS.ProcessEnv): { readonly socketPath: string; readonly capability: string } | undefined {
  const view = env.DSH_WORKSURFACE_VIEW_DIR
  if (view === undefined) return undefined
  let value: unknown
  try { value = JSON.parse(readFileSync(join(view, '.runtime.json'), 'utf8')) }
  catch { throw new WorkSurfaceError('unauthorized', 'current WorkSurface Turn Runtime binding is unavailable') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new WorkSurfaceError('unauthorized', 'current WorkSurface Turn Runtime binding is invalid')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.socketPath !== 'string' || typeof record.capability !== 'string') throw new WorkSurfaceError('unauthorized', 'current WorkSurface Turn Runtime binding is invalid')
  return { socketPath: record.socketPath, capability: record.capability }
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) { positional.push(token); continue }
    const name = token.slice(2)
    if (flags.has(name)) throw usage(`--${name} was provided more than once`)
    const value = argv[++index]
    if (value === undefined || value.startsWith('--')) throw usage(`--${name} requires a value`)
    flags.set(name, value)
  }
  return { flags, positional }
}

function allowFlags(args: Args, allowed: readonly string[]): void {
  for (const name of args.flags.keys()) if (!allowed.includes(name)) throw usage(`unknown option --${name}`)
}

function payload(args: Args): string {
  const inline = stringFlag(args, 'payload')
  const file = stringFlag(args, 'payload-file')
  if (inline !== undefined && file !== undefined) throw usage('--payload and --payload-file are mutually exclusive')
  if (file !== undefined) return readFileSync(realpathSync(file), 'utf8')
  return inline ?? '{}'
}

function stringFlag(args: Args, name: string): string | undefined {
  const value = args.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text) }
  catch { throw usage(`${label} is not valid JSON`) }
}

function usage(message: string): WorkSurfaceError {
  return new WorkSurfaceError('invalid-working-copy', `${message}; run 'ws --help'`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main()
