import { describe, expect, it } from 'vitest'
import { workSurfaceInstructions } from '../src/model/session-instructions.ts'

// Invariant assertions: [WS-20] [WS-27]

describe('DSH Session WorkSurface model contract', () => {
  it('states that the current DSH Session is one fixed Surface progression', () => {
    const text = workSurfaceInstructions('surface-a').content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('complete progress history')
    expect(text).toContain('cannot open, select, or switch')
    expect(text).toContain('surface-a')
    expect(text).toContain('turn-brief.json')
    expect(text).toContain('artifact/')
    expect(text).not.toContain('Definition has')
    expect(text).not.toContain('surface create <surface-id>')
    expect(text).not.toContain('orchestrate register <orchestration-id>')
    expect(text).toContain('ordinary file and script capabilities')
    expect(text).toContain('registration.json')
    expect(text).toContain('Runtime admits pending Registrations before append')
    expect(text).toContain('Business conditions, transformation, fan-out, join, and loop belong in ordinary Orchestrate code')
    expect(text).toContain('Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn')
  })
})
// Invariant assertion: [WS-11]
