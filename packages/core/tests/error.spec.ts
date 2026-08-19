/**
 * Contract tests for the stable failure surface.
 *
 * Every failure a caller can receive must name an executable next step: the
 * caller is usually an Orchestrator script or a child Agent choosing an action
 * without a human, so a bare code is not actionable. The `Record` type makes
 * coverage a compile-time guarantee; these assert it at runtime and check that
 * the guidance is actually usable rather than a restatement of the code.
 */
import { describe, expect, it } from 'vitest'
import { RECOVERY, WorkSurfaceError, asWorkSurfaceError } from '../src/error.ts'

const CODES = Object.keys(RECOVERY) as Array<keyof typeof RECOVERY>

describe('RECOVERY', () => {
  it('covers every stable failure code', () => {
    // Guards against a code being added with no recovery path.
    expect(CODES.length).toBeGreaterThan(0)
    for (const code of CODES) {
      expect(typeof RECOVERY[code]).toBe('string')
      expect(RECOVERY[code].length).toBeGreaterThan(0)
    }
  })

  it('offers a concrete action rather than restating the failure', () => {
    for (const code of CODES) {
      const text = RECOVERY[code]
      // An actionable alternative names a command, or a decision the caller can
      // take. Pure restatement ("invalid reference") would pass neither.
      const actionable = /\bws\b|--\w|WS_[A-Z_]+|\b(?:use|run|retry|check|choose|stay|stop|supersede|rebase|point|pass|remove|copy|re-emit)\b/i
      expect(text, `${code} must offer an executable alternative`).toMatch(actionable)
    }
  })

  it('never leaves the alternative equal to the code itself', () => {
    for (const code of CODES) {
      expect(RECOVERY[code].trim().toLowerCase()).not.toBe(code.replace(/-/g, ' '))
    }
  })
})

describe('WorkSurfaceError', () => {
  it('exposes the alternative for its code', () => {
    const error = new WorkSurfaceError('revision-conflict', 'base revision is stale')
    expect(error.alternative).toBe(RECOVERY['revision-conflict'])
    expect(error.code).toBe('revision-conflict')
    expect(error.details).toEqual({})
  })

  it('renders reason and next step together', () => {
    const error = new WorkSurfaceError('unauthorized', 'path escapes attempt workspace')
    const text = error.describe()
    expect(text).toContain('unauthorized')
    expect(text).toContain('path escapes attempt workspace')
    expect(text).toContain('next: ')
    expect(text).toContain(RECOVERY.unauthorized)
  })

  it('leaves String(error) single-line so stored causes are unchanged', () => {
    // journal.ts, store.ts, and markdown.ts capture String(error) into JSON
    // `cause` fields; describe() is opt-in precisely so those stay stable.
    const error = new WorkSurfaceError('effect-failed', 'spawn failed')
    expect(String(error)).not.toContain('\n')
  })

  it('keeps details losslessly for JSON transport', () => {
    const error = new WorkSurfaceError('effect-failed', 'spawn failed', { exitCode: 127, signal: null })
    expect(JSON.parse(JSON.stringify(error.details))).toEqual({ exitCode: 127, signal: null })
  })

  it('gives a normalized failure an alternative too', () => {
    // A thrown non-WorkSurface value still reaches the caller, so it must not
    // arrive without guidance.
    const normalized = asWorkSurfaceError(new Error('unexpected'))
    expect(normalized.code).toBe('effect-failed')
    expect(normalized.alternative).toBe(RECOVERY['effect-failed'])
  })

  it('passes a WorkSurfaceError through unchanged', () => {
    const original = new WorkSurfaceError('not-found', 'surface missing')
    expect(asWorkSurfaceError(original)).toBe(original)
  })
})
