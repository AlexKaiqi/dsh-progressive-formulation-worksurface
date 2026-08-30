import { describe, expect, it } from 'vitest'
import { workSurfaceInstructions } from '../src/model/session-instructions.ts'

// Invariant assertion: [WS-20]

describe('DSH Session WorkSurface model contract', () => {
  it('states that the current DSH Session is one fixed Surface progression', () => {
    const text = workSurfaceInstructions('surface-a').content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('complete progress history')
    expect(text).toContain('cannot open, select, or switch')
    expect(text).toContain('surface-a')
    expect(text).toContain('surface.revision.published')
    expect(text).toContain('surface create <surface-id>')
    expect(text).toContain('orchestrate register <orchestration-id>')
    expect(text).toContain('Register the Definition before emitting any root business fact')
    expect(text).toContain('For dependent branches, do not start them directly')
    expect(text).toContain('Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn')
  })
})
// Invariant assertion: [WS-11]
