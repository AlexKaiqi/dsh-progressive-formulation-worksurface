import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { sha256 } from '@pf-worksurface/core'
import type { WorkSurfaceConfig, WorkSurfaceProfile } from './types.ts'

/** User-facing plugin configuration. */
export interface Config {
  readonly root: string
  readonly attemptsRoot?: string
  readonly socketPath?: string
  readonly cliEntrypoint?: string
  readonly orchestratorGraceMs?: number
  readonly maxOutputBytes?: number
  readonly maxCrashReplays?: number
  readonly attemptRetention?: number
  readonly unboundSurfaceRetentionMs?: number
  readonly profiles: readonly WorkSurfaceProfile[]
}

const PROFILE_SCHEMA = z.object({
  name: z.string(),
  provider: z.string(),
  tokenBudget: z.number().step(1).min(1),
  maxDepth: z.number().step(1).min(0),
  maxParallel: z.number().step(1).min(1),
  toolAllow: z.array(z.string()).default(undefined as unknown as string[]),
  persona: z.string(),
  agentProvider: z.string(),
  agentModel: z.string(),
})

export const CONFIG_SCHEMA = z.object({
  root: z.string(),
  attemptsRoot: z.string(),
  socketPath: z.string(),
  cliEntrypoint: z.string(),
  orchestratorGraceMs: z.number().step(1).min(1).default(5000),
  maxOutputBytes: z.number().step(1).min(1024).default(1024 * 1024),
  maxCrashReplays: z.number().step(1).min(0).default(1),
  attemptRetention: z.number().step(1).min(1).default(10),
  unboundSurfaceRetentionMs: z.number().step(1).min(1).default(7 * 24 * 60 * 60 * 1000),
  profiles: z.array(PROFILE_SCHEMA),
}) as unknown as z<Config>

/**
 * Resolve the installed CLI export without assuming a monorepo directory layout.
 * @returns The absolute installed CLI entrypoint.
 */
export function resolveWorkSurfaceCliEntrypoint(): string {
  return createRequire(import.meta.url).resolve('@pf-worksurface/cli/bin')
}

export function resolveConfig(config: Config): WorkSurfaceConfig {
  if (config.root.trim() === '') throw new TypeError('WorkSurface root must not be blank')
  const root = resolve(config.root)
  return {
    root,
    attemptsRoot: resolve(config.attemptsRoot ?? join(root, 'runtime', 'orchestrator', 'runs')),
    socketPath: resolve(config.socketPath ?? defaultSocketPath(root)),
    cliEntrypoint: config.cliEntrypoint === undefined
      ? resolveWorkSurfaceCliEntrypoint()
      : resolve(config.cliEntrypoint),
    orchestratorGraceMs: positiveInteger(config.orchestratorGraceMs ?? 5000, 'orchestratorGraceMs'),
    maxOutputBytes: positiveInteger(config.maxOutputBytes ?? 1024 * 1024, 'maxOutputBytes'),
    maxCrashReplays: nonNegativeInteger(config.maxCrashReplays ?? 1, 'maxCrashReplays'),
    attemptRetention: positiveInteger(config.attemptRetention ?? 10, 'attemptRetention'),
    unboundSurfaceRetentionMs: positiveInteger(
      config.unboundSurfaceRetentionMs ?? 7 * 24 * 60 * 60 * 1000,
      'unboundSurfaceRetentionMs',
    ),
    profiles: config.profiles,
  }
}

function defaultSocketPath(root: string): string {
  const preferred = join(root, 'run', 'host.sock')
  if (process.platform !== 'win32' && Buffer.byteLength(preferred) > 100) {
    return join(homedir(), '.pf-worksurface', 'run', `${sha256(root).slice(0, 16)}.sock`)
  }
  return preferred
}

export function validateProfiles(profiles: readonly WorkSurfaceProfile[]): void {
  if (profiles.length === 0) throw new TypeError('at least one WorkSurface profile is required')
  const names = new Set<string>()
  for (const profile of profiles) {
    if (profile.name.trim() === '' || profile.provider.trim() === '') throw new TypeError('profile name and provider must not be blank')
    if (names.has(profile.name)) throw new TypeError(`duplicate WorkSurface profile '${profile.name}'`)
    names.add(profile.name)
    positiveInteger(profile.tokenBudget, `${profile.name}.tokenBudget`)
    nonNegativeInteger(profile.maxDepth, `${profile.name}.maxDepth`)
    positiveInteger(profile.maxParallel, `${profile.name}.maxParallel`)
  }
}

export function assertOutsideImplicitTemporaryRoots(path: string, label: string): void {
  const targets = new Set([resolve(path), canonicalPath(path)])
  const temporaryRoots = new Set(['/tmp', tmpdir()].flatMap(root => [resolve(root), canonicalPath(root)]))
  for (const target of targets) {
    for (const temporaryRoot of temporaryRoots) {
      const rel = relative(temporaryRoot, target)
      if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) continue
      throw new TypeError(
        `${label} '${target}' is inside sandbox-writable temporary root '${temporaryRoot}'; `
        + 'use a persistent non-temporary directory',
      )
    }
  }
}

export function assertSocketPath(socketPath: string, attemptsRoot: string): void {
  if (process.platform !== 'win32' && Buffer.byteLength(socketPath) > 100) {
    throw new TypeError(`WorkSurface Host socket path exceeds the portable Unix limit: ${socketPath}`)
  }
  const rel = relative(resolve(attemptsRoot), resolve(socketPath))
  if (rel === '' || (rel !== '..' && rel.startsWith(`..${sep}`) === false && isAbsolute(rel) === false)) {
    throw new TypeError('WorkSurface Host socket must be outside the Orchestrator attempts directory')
  }
}

export function positiveInteger(value: number, name: string): number {
  if (Number.isSafeInteger(value) === false || value <= 0) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}

export function nonNegativeInteger(value: number, name: string): number {
  if (Number.isSafeInteger(value) === false || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`)
  return value
}
