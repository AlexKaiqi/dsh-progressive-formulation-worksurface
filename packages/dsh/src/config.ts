import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { sha256 } from '@pf-worksurface/core'

/** User-facing event WorkSurface configuration. */
export interface Config {
  readonly root: string
  readonly workRoot?: string
  readonly socketPath?: string
}

/** Resolved filesystem implementation details, not domain identity. */
export interface WorkSurfaceConfig {
  readonly root: string
  readonly workRoot: string
  readonly definitionRoot: string
  readonly revisionRoot: string
  readonly eventRoot: string
  readonly runtimeRoot: string
  readonly socketPath: string
  /** Authority-scoped target protocol state; v4 remains readable during migration. */
  readonly targetRoot: string
}

export const CONFIG_SCHEMA = z.object({
  root: z.string(),
  workRoot: z.string().default(''),
  socketPath: z.string().default(''),
}) as unknown as z<Config>

/** Resolve paths while keeping transport and layout replaceable. */
export function resolveConfig(config: Config): WorkSurfaceConfig {
  if (config.root.trim() === '') throw new TypeError('WorkSurface root must not be blank')
  const root = resolve(config.root)
  const stateRoot = join(root, 'v4')
  return {
    root: stateRoot,
    workRoot: resolve(config.workRoot?.trim() ? config.workRoot : join(root, 'work')),
    definitionRoot: join(stateRoot, 'definitions'),
    revisionRoot: join(stateRoot, 'revisions'),
    eventRoot: join(stateRoot, 'events'),
    runtimeRoot: join(stateRoot, 'runtime'),
    socketPath: resolve(config.socketPath?.trim() ? config.socketPath : defaultSocketPath(root)),
    targetRoot: join(root, 'v5'),
  }
}

function defaultSocketPath(root: string): string {
  const preferred = join(root, 'v4', 'run', 'host.sock')
  return process.platform !== 'win32' && Buffer.byteLength(preferred) > 100
    ? join(homedir(), '.pf-worksurface', 'run', `${sha256(root).slice(0, 16)}.sock`)
    : preferred
}
