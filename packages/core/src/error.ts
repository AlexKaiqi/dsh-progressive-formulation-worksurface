/** Stable WorkSurface failures used by CLI JSON and exit-code mapping. */
export type WorkSurfaceErrorCode =
  | 'already-exists'
  | 'already-exists-conflict'
  | 'canonical-corrupt'
  | 'cancelled'
  | 'effect-failed'
  | 'invalid-id'
  | 'invalid-definition'
  | 'invalid-working-copy'
  | 'not-found'
  | 'revision-conflict'
  | 'target-not-empty'
  | 'unauthorized'

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

  /**
   * Executable next step for this failure.
   *
   * A bare code tells a caller what went wrong but not what to do, and the
   * caller can choose a next action. See {@link RECOVERY}.
   */
  get alternative(): string {
    return RECOVERY[this.code]
  }

  /**
   * Reason and next step together, for CLI output and tool results.
   *
   * Deliberately not an override of `toString`: several call sites capture
   * `String(error)` into JSON `cause` fields, and silently turning those into
   * multi-line guidance would change stored diagnostics.
   */
  describe(): string {
    return `${this.code}: ${this.message}\nnext: ${this.alternative}`
  }
}

/**
 * The executable alternative offered for every stable failure code.
 *
 * Exhaustive by construction: adding a code to {@link WorkSurfaceErrorCode}
 * without a recovery path here is a compile error, so no failure can reach a
 * caller with nothing to try next.
 */
export const RECOVERY: Record<WorkSurfaceErrorCode, string> = {
  'already-exists': 'reuse the existing identity or choose a distinct domain id',
  'already-exists-conflict': 'read the existing event, choose a new operation key, or retry with identical canonical content',
  'canonical-corrupt': 'stop mutation and repair the affected event stream or immutable object before retrying',
  cancelled: 'retry the same operation when the caller is ready',
  'effect-failed': 'check the reported details and retry the event operation',
  'invalid-id': 'use a valid Surface, Orchestration, Registration, Session reference, event, or revision id',
  'invalid-definition': 'check the reported Definition field and register the validated Definition again',
  'invalid-working-copy': 'check the request or checkout a fresh artifact revision before retrying',
  'not-found': 'replay the Surface or inspect the orchestration to confirm the referenced fact exists',
  'revision-conflict': 'read the current published revision, rebase the artifact, then commit against that revision',
  'target-not-empty': 'choose an empty target path, or remove the existing contents before checking out',
  unauthorized: 'use the authenticated WorkSurface Service and only declared handler roles',
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
