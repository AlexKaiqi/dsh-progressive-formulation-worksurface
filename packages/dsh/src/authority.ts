import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sha256, SurfaceId, WorkSurfaceError } from '@pf-worksurface/core'
import type { SurfaceIdType } from '@pf-worksurface/core'
import type { WorkSurfaceRpcRequest } from '@pf-worksurface/cli'
import type { AttemptAuthority, ChildCredential } from './types.ts'

export interface AuthorizedRequest {
  readonly attempt: AttemptAuthority
  readonly child?: ChildCredential
}

export function authorizeRequest(
  attempts: ReadonlyMap<string, AttemptAuthority>,
  request: WorkSurfaceRpcRequest,
  delegatedAttempts: ReadonlyMap<string, AttemptAuthority> = new Map(),
): AuthorizedRequest {
  const attempt = attempts.get(request.attemptId) ?? delegatedAttempts.get(request.attemptId)
  if (attempt === undefined) throw new WorkSurfaceError('unauthorized', `attempt '${request.attemptId}' is not active`)
  if (timingSafeTextEqual(attempt.token, request.token)) return { attempt }
  for (const child of attempt.childCredentials.values()) {
    if (timingSafeTextEqual(child.token, request.token)) return { attempt, child }
  }
  throw new WorkSurfaceError('unauthorized', 'invalid WorkSurface attempt token')
}

export function requireOrchestrator(authority: { child?: ChildCredential }): void {
  if (authority.child !== undefined) throw new WorkSurfaceError('unauthorized', 'operation requires Orchestrator authority')
}

export function requireSurface(
  authority: { attempt: AttemptAuthority; child?: ChildCredential },
  surfaceInput: string,
): SurfaceIdType {
  const surface = SurfaceId(surfaceInput)
  if (authority.child !== undefined) {
    if (surface !== authority.child.surface) throw new WorkSurfaceError('unauthorized', `child Agent cannot access Surface '${surface}'`)
    return surface
  }
  if (authority.attempt.surfaces.has(surface) === false) {
    throw new WorkSurfaceError('unauthorized', `attempt cannot access Surface '${surface}'`)
  }
  return surface
}

export function childBinding(
  attempts: ReadonlyMap<string, AttemptAuthority>,
  agentId: string,
): { attempt: AttemptAuthority; credential: ChildCredential } | undefined {
  for (const attempt of attempts.values()) {
    const credential = attempt.childCredentials.get(agentId)
    if (credential !== undefined) return { attempt, credential }
  }
  return undefined
}

export async function attemptPath(attempt: AttemptAuthority, input: string): Promise<string> {
  const target = resolve(attempt.workspaceRoot, input)
  const rel = relative(attempt.workspaceRoot, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new WorkSurfaceError('unauthorized', `path escapes attempt workspace: ${input}`)
  }
  let cursor = attempt.workspaceRoot
  for (const component of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, component)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new WorkSurfaceError('unauthorized', `symbolic links are forbidden at the Host boundary: ${cursor}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return target
}

export function timingSafeTextEqual(left: string, right: string): boolean {
  const leftHash = sha256(left)
  const rightHash = sha256(right)
  let mismatch = 0
  for (let index = 0; index < leftHash.length; index += 1) mismatch |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index)
  return mismatch === 0
}
