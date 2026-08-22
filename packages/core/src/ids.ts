import { WorkSurfaceError } from './error.ts'
import { sha256 } from './hash.ts'
import type { BlockId, SurfaceId } from './types.ts'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Validate and brand a Surface id.
 * @param value - Candidate identifier.
 * @returns The validated Surface id.
 */
export function SurfaceId(value: string): SurfaceId {
  if (!ID_RE.test(value)) throw new WorkSurfaceError('invalid-id', `invalid Surface id '${value}'`, { value })
  return value as SurfaceId
}

/**
 * Validate and brand a Block id.
 * @param value - Candidate identifier.
 * @returns The validated Block id.
 */
export function BlockId(value: string): BlockId {
  if (!ID_RE.test(value)) throw new WorkSurfaceError('invalid-id', `invalid Block id '${value}'`, { value })
  return value as BlockId
}

/**
 * Derive a deterministic, readable child Surface id from an idempotency key.
 * @param attemptId - Owning attempt identity.
 * @param key - Stable effect key.
 * @returns A validated deterministic Surface id.
 */
export function deriveSurfaceId(attemptId: string, key: string): SurfaceId {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'surface'
  return SurfaceId(`ws-${slug}-${sha256(`${attemptId}\0${key}`).slice(0, 10)}`)
}

/**
 * Derive the root Surface owned by one DSH Session. A Session and its root
 * Surface are one work unit: the Surface id is a deterministic function of the
 * Session id, so no binding record is required to resolve the root.
 * @param sessionId - The durable DSH Session id.
 * @returns The validated root Surface id.
 */
export function sessionSurfaceId(sessionId: string): SurfaceId {
  return deriveSurfaceId('session-root', sessionId)
}
