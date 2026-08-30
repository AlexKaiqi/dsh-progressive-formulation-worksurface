import { describe, expect, it } from 'vitest'
import { projectSurfaceLifecycle, surfaceSubject, type Revision, type WorkSurfaceEvent } from '../src/index.ts'

const revision = `sha256:${'a'.repeat(64)}` as Revision

function candidate(seq: number, name: string) {
  const event: WorkSurfaceEvent = {
    version: 1,
    id: `evt-${seq}`,
    subject: surfaceSubject('surface'),
    seq,
    name,
    payload: {},
    causes: [],
    meta: name.startsWith('surface.') ? { sessionId: 'session-a', turn: 3, outputRevision: revision } : {},
    recordedAt: '2026-08-30T00:00:00.000Z',
  }
  return { ref: { subject: 'surface:surface' as const, seq, id: event.id }, event }
}

describe('Surface lifecycle projection', () => {
  it('projects publication with exact DSH Session/Turn evidence', () => {
    expect(projectSurfaceLifecycle([candidate(0, 'surface.revision.published')])).toMatchObject({
      phase: 'published', latestEventId: 'evt-0', sessionId: 'session-a', turn: 3,
    })
  })

  it('projects a publication conflict without inventing execution state', () => {
    expect(projectSurfaceLifecycle([candidate(0, 'surface.publish.conflicted')])).toMatchObject({ phase: 'conflicted' })
  })

  it('uses explicit view interpretations for business states', () => {
    expect(projectSurfaceLifecycle([candidate(0, 'review.accepted')], [{ event: 'review.accepted', display: 'completed' }]))
      .toMatchObject({ phase: 'completed' })
    expect(projectSurfaceLifecycle([candidate(0, 'approval.requested')], [{ event: 'approval.requested', display: 'waiting-user' }]))
      .toMatchObject({ phase: 'waiting-user' })
  })

  it('does not infer DSH execution state from arbitrary Surface events', () => {
    expect(projectSurfaceLifecycle([candidate(0, 'work.started')])).toMatchObject({ phase: 'idle' })
  })
})
// Invariant assertion: [WS-11]
