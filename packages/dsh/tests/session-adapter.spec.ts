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
    expect(text).not.toContain('surface create <surface-id>')
    expect(text).not.toContain('orchestrate register <orchestration-id>')
    expect(text).toContain('ordinary file and script capabilities')
    expect(text).toContain('registration.json')
    expect(text).toContain('Runtime fixes every pending registration before appending that fact')
    expect(text).toContain('dependent Surfaces wait for their exact conditions')
    expect(text).toContain('Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn')
  })
})
// Invariant assertion: [WS-11]
