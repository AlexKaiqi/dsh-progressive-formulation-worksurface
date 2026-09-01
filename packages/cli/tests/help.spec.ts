// Invariant assertions: [WS-20] [WS-27]
// Model-readiness evidence: [MR-SCENARIO-HELP-L0]
import { describe, expect, it } from 'vitest'
import { HELP, helpFor } from '../src/help.ts'

describe('ws help', () => {
  it('routes an Agent by model-owned action without exposing Runtime internals', () => {
    expect(HELP).toContain('durable, independently assessable work')
    expect(HELP).toContain('Use an ordinary DSH Session')
    for (const topic of ['author', 'coordinate', 'emit', 'recover']) expect(HELP).toContain(topic)
    expect(HELP).toContain('ws emit <event-name>')
    expect(HELP).not.toContain('ws open')
    expect(HELP).not.toContain('surface create')
    expect(HELP).not.toContain('orchestrate register')
    expect(HELP).not.toContain('--from')
    for (const forbidden of ['namespace', 'digest', 'ledger', 'socket', 'capability', 'CAS']) expect(HELP).not.toContain(forbidden)
  })

  it('gives each scenario the complete model-owned action contract', () => {
    const author = helpFor('author')
    expect(author).toContain('starting a first Surface from an ordinary Agent Session')
    expect(author).toContain('DSH_WORKSURFACE_ROOT/surfaces/<surface-id>')
    for (const heading of ['Goal', 'Acceptance Criteria', 'Known Facts and Constraints', 'Assumptions', 'Open Questions', 'Current Decisions', 'Deliverables and Evidence']) {
      expect(author).toContain(`# ${heading}`)
    }

    const coordinate = helpFor('coordinate')
    expect(coordinate).toContain('orchestrations/<orchestration-id>/artifact/')
    expect(coordinate).toContain('registration.json beside artifact/')
    expect(coordinate).toContain('does not create, delete, or rebind Surfaces')
    expect(coordinate).toContain('fan-out, join, sequencing, and loops in ordinary entrypoint code')

    const emit = helpFor('emit')
    expect(emit).toContain('turn-brief.json')
    expect(emit).toContain('command.argv as argv exactly')
    expect(emit).toContain('They are not WorkSurface domain Events')
    expect(emit).toContain('Outside a managed Surface Turn, do not use ws emit')
    expect(emit).not.toContain('management transport')

    const recover = helpFor('recover')
    expect(recover).toContain('Do not blindly repeat a non-idempotent external side effect')
    expect(recover).not.toMatch(/ledger|digest|namespace|socket|capability|CAS/)
  })

  it('fails closed for an unknown scenario instead of inventing guidance', () => {
    expect(helpFor('create')).toBe("Unknown WorkSurface help topic 'create'. Choose: author, coordinate, emit, recover.\n")
  })
})
// Invariant assertion: [WS-20]
