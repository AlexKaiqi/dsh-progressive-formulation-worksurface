import { describe, expect, it } from 'vitest'
import { WORKSURFACE_GLOBAL_INSTRUCTIONS } from '../src/model/global-instructions.ts'
import { workSurfaceInstructions } from '../src/model/session-instructions.ts'

// Invariant assertions: [WS-20] [WS-27]
// Model-readiness evidence: [MR-GLOBAL-GUIDANCE-L0] [MR-SURFACE-SESSION-GUIDANCE-L0]

describe('DSH Session WorkSurface model contract', () => {
  it('keeps global discovery short and sends operational detail to scenario help', () => {
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('independently assessable Surfaces')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('Use an ordinary DSH Session')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('`"$DSH_WORKSURFACE_CLI" help`')
    for (const runtimeOwned of ['namespace', 'digest', 'ledger', 'socket', 'capability', 'CAS']) {
      expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).not.toContain(runtimeOwned)
    }
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS.length).toBeLessThan(500)
  })

  it('states that the current DSH Session is one fixed Surface progression', () => {
    const text = workSurfaceInstructions('surface-a').content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('complete progress history')
    expect(text).toContain('cannot open, select, or switch')
    expect(text).toContain('surface-a')
    expect(text).toContain('turn-brief.json')
    for (const topic of ['author', 'coordinate', 'emit', 'recover']) expect(text).toContain(`help ${topic}`)
    expect(text).toContain('ordinary file and script capabilities')
    expect(text).toContain('exact `command.argv` as argv')
    expect(text).not.toContain('seven headings')
    expect(text).not.toContain('registration.json')
    expect(text).not.toMatch(/namespace|digest|ledger|socket|capability|CAS/)
  })
})
// Invariant assertion: [WS-11]
