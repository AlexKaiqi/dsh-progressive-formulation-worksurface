import { describe, expect, it } from 'vitest'
import { HELP } from '../src/help.ts'

describe('ws help', () => {
  it('documents fixed Surface Session event publication', () => {
    expect(HELP).toContain('ws emit <event-name>')
    expect(HELP).toContain('cannot open or switch the current Session')
    expect(HELP).not.toContain('ws open')
    expect(HELP).not.toContain('surface create')
    expect(HELP).not.toContain('orchestrate register')
    expect(HELP).toContain('ordinary file and script capabilities')
    expect(HELP).not.toContain('--from')
    expect(HELP).toContain('DSH_CONTEXT_FILE')
    expect(HELP).toContain('surface.revision.published')
    for (const forbidden of ['derive', 'clone', 'commit']) expect(HELP).not.toContain(forbidden)
  })
})
// Invariant assertion: [WS-20]
