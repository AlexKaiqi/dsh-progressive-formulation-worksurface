import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  defineOrchestration,
  deriveActivations,
  inspectEventCondition,
  projectPlannedFlow,
  surfaceSubject,
  type ObservedEvent,
  type OrchestrationDefinition,
  type WorkSurfaceEvent,
} from '../src/index.ts'

const definition: OrchestrationDefinition = {
  version: 1,
  roles: ['reviewA', 'reviewB', 'target'],
  subscriptions: [{
    id: 'join',
    history: 'all',
    key: '$.payload.caseId',
    when: { all: [
      { role: 'reviewA', event: 'review.accepted' },
      { role: 'reviewB', event: 'review.accepted' },
    ] },
    reaction: { emit: [{ role: 'target', event: 'review.bundle.ready', operationKey: 'advance-target', payload: { caseId: '${activation.key}' } }] },
  }],
}

function observed(role: string, surface: string, id: string, seq: number, caseId: string, afterRegistration = true): ObservedEvent {
  const event: WorkSurfaceEvent = {
    version: 1, id, subject: surfaceSubject(surface), seq, name: 'review.accepted', payload: { caseId },
    causes: [], meta: {}, recordedAt: '2026-08-30T00:00:00.000Z',
  }
  return { role, event, afterRegistration }
}

describe('Definition v1', () => {
  it('requires history and a business key for joins', () => {
    expect(() => defineOrchestration(definition)).not.toThrow()
    const noHistory = structuredClone(definition) as unknown as { subscriptions: Array<Record<string, unknown>> }
    delete noHistory.subscriptions[0]!.history
    expect(() => defineOrchestration(noHistory)).toThrow(/history/)
    const noKey = structuredClone(definition) as unknown as { subscriptions: Array<Record<string, unknown>> }
    delete noKey.subscriptions[0]!.key
    expect(() => defineOrchestration(noKey)).toThrow(/activation key/)
  })

  it('accepts explicit Session followup reactions without inventing a Surface execution event', () => {
    const followup: OrchestrationDefinition = {
      version: 1,
      roles: ['source', 'target'],
      subscriptions: [{
        id: 'continue', history: 'all',
        when: { role: 'source', event: 'review.accepted' },
        reaction: { followup: [{ role: 'target', message: 'Continue ${activation.key}', operationKey: 'continue-target' }] },
      }],
    }
    expect(() => defineOrchestration(followup)).not.toThrow()
  })

  it('groups only matching business keys and includes Registration identity in ActivationId', () => {
    const events = [
      observed('reviewA', 'a', 'a-1', 0, 'case-1'),
      observed('reviewB', 'b', 'b-2', 0, 'case-2'),
      observed('reviewB', 'b', 'b-1', 1, 'case-1'),
    ]
    const first = deriveActivations('reg-a', definition, events, new Set())
    const replayed = deriveActivations('reg-a', definition, [...events].reverse(), new Set())
    expect(first).toHaveLength(1)
    expect(first).toEqual(replayed)
    expect(first[0]).toMatchObject({ subscriptionId: 'join', key: '"case-1"', sources: [{ role: 'reviewA' }, { role: 'reviewB' }] })
    expect(deriveActivations('reg-b', definition, events, new Set())[0]?.id).not.toBe(first[0]?.id)
  })

  it('preserves all versus any semantics even when the flat possible edges match', () => {
    const anyDefinition: OrchestrationDefinition = {
      ...definition,
      subscriptions: [{ ...definition.subscriptions[0]!, when: { any: [
        { role: 'reviewA', event: 'review.accepted' },
        { role: 'reviewB', event: 'review.accepted' },
      ] } }],
    }
    expect(projectPlannedFlow(definition)).toEqual(projectPlannedFlow(anyDefinition))
    const onlyA = [observed('reviewA', 'a', 'a-1', 0, 'case-1')]
    expect(inspectEventCondition(definition.subscriptions[0]!.when, onlyA)).toMatchObject({ kind: 'all', satisfied: false })
    expect(inspectEventCondition(anyDefinition.subscriptions[0]!.when, onlyA)).toMatchObject({ kind: 'any', satisfied: true })
  })

  it('recovers the earliest exact-count activation even after later events arrive', () => {
    const exact: OrchestrationDefinition = {
      ...definition,
      subscriptions: [{ ...definition.subscriptions[0]!, when: { count: {
        selector: { role: 'reviewA', event: 'review.accepted' }, operator: 'eq', value: 2,
      } } }],
    }
    const events = [
      observed('reviewA', 'a', 'a-1', 0, 'case-1'),
      observed('reviewA', 'a', 'a-2', 1, 'case-1'),
      observed('reviewA', 'a', 'a-3', 2, 'case-1'),
    ]
    expect(deriveActivations('reg-a', exact, events, new Set())[0]?.sources).toHaveLength(2)
    expect(inspectEventCondition(exact.subscriptions[0]!.when, events)).toMatchObject({ kind: 'count', satisfied: false })
  })

  it('rejects cross-stream declarative sequence and escaping handler paths', () => {
    expect(() => defineOrchestration({
      version: 1, roles: ['a', 'b'], subscriptions: [{ id: 's', history: 'all', key: '$.payload.caseId',
        when: { sequence: [{ role: 'a', event: 'start' }, { role: 'b', event: 'finish' }] },
        reaction: { emit: [{ role: 'b', event: 'done', operationKey: 'done', payload: null }] } }],
    })).toThrow(/cross-stream sequence/)
    expect(() => defineOrchestration({
      version: 1, roles: ['a'], subscriptions: [{ id: 's', history: 'all', when: { role: 'a', event: 'start' },
        reaction: { handler: { command: 'node', path: '../handler.mjs', reads: ['a'], emits: ['a'] } } }],
    })).toThrow(/handler path/)
  })

  it('keeps every shipped Definition example on the normative v1 contract', async () => {
    const examples = new URL('../../../examples/', import.meta.url)
    const files = (await readdir(examples)).filter(name => name.endsWith('.definition.json'))
    for (const file of files) {
      const input = JSON.parse(await readFile(new URL(file, examples), 'utf8'))
      expect(() => defineOrchestration(input), file).not.toThrow()
    }
  })
})
// Invariant assertions: [WS-04] [WS-07] [WS-15] [WS-16]
