import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BUILTIN_EVENT_CATALOG } from '../src/builtin-event-catalog.ts'

// Invariant assertion: [WS-24]

describe('built-in Event catalog Runtime projection', () => {
  it('matches the normative design catalog exactly', async () => {
    const source = JSON.parse(await readFile(new URL('../../../spec/design/builtin-event-catalog.json', import.meta.url), 'utf8')) as { events: unknown }
    expect(BUILTIN_EVENT_CATALOG).toEqual(source.events)
  })
})
