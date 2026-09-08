import { describe, expect, it } from 'vitest'
import { WORKSURFACE_GLOBAL_INSTRUCTIONS } from '../src/model/global-instructions.ts'
import { workSurfaceInstructions, workSurfaceTurnInstructions } from '../src/model/session-instructions.ts'

// Invariant assertions: [WS-20] [WS-27]
// Model-readiness evidence: [MR-GLOBAL-GUIDANCE-L0] [MR-SURFACE-SESSION-GUIDANCE-L0]

describe('DSH Session WorkSurface model contract', () => {
  it('keeps global discovery short and sends operational detail to scenario help', () => {
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('independently assessable Surfaces')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('use an ordinary DSH Session')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('`"$DSH_WORKSURFACE_CLI" help`')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('read the relevant help yourself')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('directly from this guidance, without tools or help')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).not.toContain('fallback')
    for (const runtimeOwned of ['namespace', 'digest', 'ledger', 'socket', 'CAS']) {
      expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).not.toContain(runtimeOwned)
    }
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS.length).toBeLessThanOrEqual(1_200)
  })

  it('states that the current DSH Session is one fixed Surface progression', () => {
    const text = workSurfaceInstructions('surface-a').content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('complete progress history')
    expect(text).toContain('cannot open, select, or switch')
    expect(text).toContain('surface-a')
    expect(text).toContain('turn-brief.json')
    for (const topic of ['author', 'coordinate', 'publish', 'emit', 'recover']) expect(text).toContain(`help ${topic}`)
    expect(text).toContain('`filePublication` command')
    expect(text).toContain('ordinary file and script capabilities')
    expect(text).toContain('resolve environment locators and replace parameter placeholders in `command.argv`')
    expect(text).toContain('execute the resolved argv directly')
    expect(text).toContain('if the Turn Brief variable is missing, report the host injection failure')
    expect(text).not.toContain('seven headings')
    expect(text).not.toContain('registration.json')
    expect(text).not.toMatch(/namespace|digest|ledger|socket|capability|CAS/)
  })

  it('provides per-Turn inspection paths without claiming they replace Bash injection', () => {
    const text = workSurfaceTurnInstructions('surface-a', {
      surfaceDir: '/tmp/work/surfaces/surface-a',
      turnBriefPath: '/tmp/state/runtime/turn-views/session/1/turn-brief.json',
      authoringRoot: '/tmp/work',
      cliPath: '/tmp/bin/ws',
    }).content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('/tmp/work/surfaces/surface-a')
    expect(text).toContain('/tmp/state/runtime/turn-views/session/1/turn-brief.json')
    expect(text).toContain('/tmp/bin/ws')
    expect(text).toContain('do not reuse these Turn paths after the Turn ends')
    expect(text).toContain('Missing Bash environment variables are a host injection failure')
  })
})
// Invariant assertion: [WS-11]
