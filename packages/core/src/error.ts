/** Stable WorkSurface failures used by CLI JSON and exit-code mapping. */
export type WorkSurfaceErrorCode =
  | 'already-exists'
  | 'block-header-mismatch'
  | 'canonical-corrupt'
  | 'cancelled'
  | 'dangling-reference'
  | 'effect-failed'
  | 'idempotency-key-conflict'
  | 'invalid-id'
  | 'invalid-markdown-envelope'
  | 'invalid-reference'
  | 'invalid-working-copy'
  | 'not-found'
  | 'physical-delete-forbidden'
  | 'revision-conflict'
  | 'target-not-empty'
  | 'unauthorized'
  | 'unsupported-profile'

/** Error with a stable code and lossless JSON-safe details. */
export class WorkSurfaceError extends Error {
  constructor(
    readonly code: WorkSurfaceErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'WorkSurfaceError'
  }
}

/**
 * Convert an arbitrary failure into a stable WorkSurface error.
 * @param error - Unknown caught value.
 * @returns The original or normalized WorkSurface error.
 */
export function asWorkSurfaceError(error: unknown): WorkSurfaceError {
  if (error instanceof WorkSurfaceError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new WorkSurfaceError('effect-failed', message)
}
