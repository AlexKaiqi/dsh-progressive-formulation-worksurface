import { describe, expect, it } from 'vitest'
import {
  eventRef,
  emissionEventId,
  surfaceSubject,
  publicationEventId,
  type Revision,
  validateWorkSurfaceEvent,
  type WorkSurfaceEvent,
} from '../src/index.ts'

const event = (id: string, seq = 0): WorkSurfaceEvent => ({
  version: 1,
  id,
  subject: surfaceSubject('surface-a'),
  seq,
  name: 'review.accepted',
  payload: { caseId: 'case-1' },
  causes: [],
  meta: {},
  recordedAt: '2026-08-30T00:00:00.000Z',
})

describe('event envelope v1', () => {
  it('uses public subject identity and a self-checking EventRef', () => {
    const candidate = event('evt-a', 4)
    expect(() => validateWorkSurfaceEvent(candidate)).not.toThrow()
    expect(eventRef(candidate)).toEqual({ subject: 'surface:surface-a', seq: 4, id: 'evt-a' })
    expect(JSON.stringify(candidate)).not.toContain('sessionId')
  })

  it('requires cross-stream causes to carry subject, seq, and event id', () => {
    const candidate: WorkSurfaceEvent = {
      ...event('evt-b'),
      causes: [{ subject: 'surface:source', seq: 3, id: 'evt-source' }],
    }
    expect(() => validateWorkSurfaceEvent(candidate)).not.toThrow()
    expect(() => validateWorkSurfaceEvent({
      ...candidate,
      causes: [{ subject: 'surface:source', seq: 3 }],
    } as WorkSurfaceEvent)).toThrow(/EventRef id/)
  })

  it('derives managed and publication ids from all idempotency dimensions', () => {
    const left = emissionEventId('reg-a', 'act-a', 'advance', 'surface:target-a')
    expect(left).toBe(emissionEventId('reg-a', 'act-a', 'advance', 'surface:target-a'))
    expect(left).not.toBe(emissionEventId('reg-a', 'act-a', 'advance', 'surface:target-b'))
    const output = `sha256:${'a'.repeat(64)}` as Revision
    expect(publicationEventId('session-a', 1, 'surface-a', output)).toBe(publicationEventId('session-a', 1, 'surface-a', output))
    expect(publicationEventId('session-a', 1, 'surface-a', output)).not.toBe(publicationEventId('session-a', 2, 'surface-a', output))
  })
})
// Invariant assertions: [WS-01] [WS-06]
