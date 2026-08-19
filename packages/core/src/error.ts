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

  /**
   * Executable next step for this failure.
   *
   * A bare code tells a caller what went wrong but not what to do, and the
   * caller here is usually an Orchestrator script or a child Agent that has to
   * choose a next action without a human. See {@link RECOVERY}.
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
  'already-exists': 'use the existing Surface, or retry `ws new` with a different --key to create a distinct one',
  'block-header-mismatch': 'run `ws show <surface>` and re-emit the block with its header exactly as returned',
  'canonical-corrupt': 'stop writing and check the WorkSurface root; canonical state must be repaired before any further effect',
  cancelled: 'the caller cancelled this attempt; retry the command with the same --key once the caller is ready',
  'dangling-reference': 'run `ws show <surface>` to list live references, then point the block at one that resolves',
  'effect-failed': 'check the reported details, then retry the command with the same --key',
  'idempotency-key-conflict': 'the same --key was used for a different effect; pass --retry to resume the original, or use a new --key',
  'invalid-id': 'use an id returned by `ws new` or `ws show`; do not construct Surface or block ids by hand',
  'invalid-markdown-envelope': 'run `ws help init` for the envelope format, then re-emit the working copy',
  'invalid-reference': 'run `ws show <surface>` and copy the reference verbatim from its output',
  'invalid-working-copy': 'run `ws checkout <surface> <target>` again and edit that fresh copy',
  'not-found': 'run `ws show <surface>` to confirm the target exists at the revision you expect',
  'physical-delete-forbidden': 'supersede the block with a new revision instead of deleting it',
  'revision-conflict': 'run `ws show <surface>` for the current revision, rebase your edit on it, then commit with --base set to that revision',
  'target-not-empty': 'choose an empty target path, or remove the existing contents before checking out',
  unauthorized: 'stay inside the attempt workspace and under the Surface named by WS_ROOT_SURFACE; use `ws checkout` to obtain a writable path',
  'unsupported-profile': 'run `ws show --projection` without --profile, or pass a profile declared in the plugin configuration',
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
