#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { asWorkSurfaceError, sha256, WorkSurfaceError } from '@pf-worksurface/core'
import { WorkSurfaceHostClient } from './client.ts'
import { HELP, VERSION } from './help.ts'

interface Args { readonly flags: Map<string, string | true>; readonly positional: readonly string[] }

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write(HELP); return 0 }
  if (argv.length === 1 && argv[0] === '--version') { process.stdout.write(`${VERSION}\n`); return 0 }
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
  if (args.positional[0] === 'surface' && args.positional[1] === 'create' && args.positional.length === 3) return createSurface(args, env)
  if (args.positional[0] === 'orchestrate' && args.positional[1] === 'register' && args.positional.length === 3) return registerOrchestration(args, env)
  throw usage('expected `ws emit`, `ws surface create`, or `ws orchestrate register`')
}

async function emit(args: Args, env: NodeJS.ProcessEnv): Promise<unknown> {
  allowFlags(args, ['surface', 'key', 'payload', 'payload-file', 'socket', 'capability'])
  const target = args.positional[1]!
  const surfaceId = stringFlag(args, 'surface') ?? env.DSH_SURFACE_ID
  const client = clientFor(args, env)
  const capability = stringFlag(args, 'capability') ?? env.DSH_WORKSURFACE_CAPABILITY
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

async function createSurface(args: Args, env: NodeJS.ProcessEnv): Promise<unknown> {
  allowFlags(args, ['contract-file', 'socket', 'capability'])
  const capability = managedCapability(args, env)
  const contractPath = requiredFlag(args, 'contract-file')
  const markdown = readFileSync(realpathSync(contractPath), 'utf8')
  return clientFor(args, env).call('surface.create', {
    capability,
    surfaceId: args.positional[2]!,
    markdown,
  })
}

async function registerOrchestration(args: Args, env: NodeJS.ProcessEnv): Promise<unknown> {
  allowFlags(args, ['definition-file', 'bindings', 'bindings-file', 'registration', 'socket', 'capability'])
  const capability = managedCapability(args, env)
  const definition = parseJson(readFileSync(realpathSync(requiredFlag(args, 'definition-file')), 'utf8'), 'definition')
  const inlineBindings = stringFlag(args, 'bindings')
  const bindingsFile = stringFlag(args, 'bindings-file')
  if ((inlineBindings === undefined) === (bindingsFile === undefined)) throw usage('exactly one of --bindings and --bindings-file is required')
  const bindings = parseBindings(bindingsFile === undefined ? inlineBindings! : readFileSync(realpathSync(bindingsFile), 'utf8'))
  return clientFor(args, env).call('orchestrate.register', {
    capability,
    orchestrationId: args.positional[2]!,
    registrationId: requiredFlag(args, 'registration'),
    definition,
    bindings,
  })
}

function clientFor(args: Args, env: NodeJS.ProcessEnv): WorkSurfaceHostClient {
  const socket = stringFlag(args, 'socket') ?? env.DSH_WORKSURFACE_SOCKET
  if (socket === undefined) throw new WorkSurfaceError('unauthorized', '--socket is required outside a managed DSH Turn')
  return new WorkSurfaceHostClient(socket)
}

function managedCapability(args: Args, env: NodeJS.ProcessEnv): string {
  const capability = stringFlag(args, 'capability') ?? env.DSH_WORKSURFACE_CAPABILITY
  if (capability === undefined) throw new WorkSurfaceError('unauthorized', 'a live DSH WorkSurface Turn capability is required')
  return capability
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

function requiredFlag(args: Args, name: string): string {
  const value = stringFlag(args, name)
  if (value === undefined) throw usage(`--${name} is required`)
  return value
}

function stringFlag(args: Args, name: string): string | undefined {
  const value = args.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text) }
  catch { throw usage(`${label} is not valid JSON`) }
}

function parseBindings(text: string): Record<string, string> {
  const value = parseJson(text, 'bindings')
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some(item => typeof item !== 'string' || item === '')) {
    throw usage('bindings must be a JSON object of role-to-Surface strings')
  }
  return value as Record<string, string>
}

function usage(message: string): WorkSurfaceError {
  return new WorkSurfaceError('invalid-working-copy', `${message}; run 'ws --help'`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main()
