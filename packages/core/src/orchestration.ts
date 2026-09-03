import { sha256, stableStringify } from './hash.ts'
import {
  eventRef,
  expressionRoles,
  isSelector,
  type ActivationSource,
  type EventExpression,
  type EventSelector,
  type HostOperationReceipt,
  type ObservedEvent,
  type OrchestrationActivation,
  type OrchestrationDefinition,
  type OrchestrationRecord,
  type RegistrationId,
  type SubscriptionDefinition,
} from './event-model.ts'

export type EventConditionInspection =
  | { readonly kind: 'event'; readonly satisfied: boolean; readonly selector: EventSelector; readonly matches: readonly ActivationSource[] }
  | { readonly kind: 'all' | 'any'; readonly satisfied: boolean; readonly expressions: readonly EventConditionInspection[] }
  | { readonly kind: 'count'; readonly satisfied: boolean; readonly selector: EventSelector; readonly operator: 'eq' | 'gte' | 'lte'; readonly value: number; readonly matches: readonly ActivationSource[] }
  | { readonly kind: 'sequence'; readonly satisfied: boolean; readonly steps: readonly { readonly selector: EventSelector; readonly match?: ActivationSource }[] }

export interface PlannedFlowEdge {
  readonly subscriptionId: string
  readonly sourceRole: string
  readonly targetRole: string
}

export interface ActualFlowEdge {
  readonly subscriptionId: string
  readonly activationId: string
  readonly activationKey: string
  readonly operationKey: string
  readonly source: ActivationSource
  readonly targetRole: string
  readonly target: { readonly subject: string; readonly seq: number; readonly id: string } | HostOperationReceipt
}

/**
 * Derive at most one activation per explicit business key. For a single-event
 * subscription without a key, the source EventId is the business key.
 */
export function deriveActivations(
  registrationId: RegistrationId,
  definition: OrchestrationDefinition,
  events: readonly ObservedEvent[],
  existingActivationIds: ReadonlySet<string>,
): readonly OrchestrationActivation[] {
  const result: OrchestrationActivation[] = []
  for (const subscription of definition.subscriptions) {
    const eligible = subscription.history === 'all' ? events : events.filter(event => event.afterRegistration)
    const groups = activationGroups(subscription, eligible)
    for (const [key, candidates] of groups) {
      const sources = evaluateOne(subscription.when, sortObserved(candidates))
      if (sources === null) continue
      const id = `act_${sha256(`${registrationId}\0${subscription.id}\0${key}`).slice(0, 40)}`
      if (existingActivationIds.has(id)) continue
      result.push({ id, subscriptionId: subscription.id, key, sources: normalizeSources(sources) })
    }
  }
  return result.sort((left, right) => left.id.localeCompare(right.id))
}

export function inspectEventCondition(expression: EventExpression, events: readonly ObservedEvent[]): EventConditionInspection {
  return inspect(expression, sortObserved(events))
}

export function subscriptionFor(definition: OrchestrationDefinition, activation: OrchestrationActivation): SubscriptionDefinition {
  const subscription = definition.subscriptions.find(candidate => candidate.id === activation.subscriptionId)
  if (subscription === undefined) throw new Error(`Definition lacks subscription '${activation.subscriptionId}'`)
  return subscription
}

export function projectPlannedFlow(definition: OrchestrationDefinition): readonly PlannedFlowEdge[] {
  const edges = new Map<string, PlannedFlowEdge>()
  for (const subscription of definition.subscriptions) {
    const targets = 'emit' in subscription.reaction
      ? subscription.reaction.emit.map(action => action.role)
      : 'followup' in subscription.reaction
        ? subscription.reaction.followup.map(action => action.role)
        : subscription.reaction.handler.emits
    for (const sourceRole of expressionRoles(subscription.when)) {
      for (const targetRole of targets) {
        const edge = { subscriptionId: subscription.id, sourceRole, targetRole }
        edges.set(stableStringify(edge), edge)
      }
    }
  }
  return [...edges.values()]
}

export function projectActualFlow(records: readonly OrchestrationRecord[]): readonly ActualFlowEdge[] {
  const activations = new Map<string, OrchestrationActivation>()
  const settled = new Map<string, Extract<OrchestrationRecord, { kind: 'operation-settled' }>>()
  for (const record of records) {
    if (record.kind === 'activation-opened') activations.set(record.activation.id, record.activation)
    if (record.kind === 'operation-settled') settled.set(`${record.activationId}\0${record.operationKey}`, record)
  }
  return [...settled.values()].flatMap(operation => {
    const activation = activations.get(operation.activationId)
    if (activation === undefined) return []
    return activation.sources.map(source => ({
      subscriptionId: activation.subscriptionId,
      activationId: activation.id,
      activationKey: activation.key,
      operationKey: operation.operationKey,
      source,
      targetRole: operation.targetRole,
      target: operation.target,
    }))
  })
}

function activationGroups(subscription: SubscriptionDefinition, events: readonly ObservedEvent[]): ReadonlyMap<string, readonly ObservedEvent[]> {
  if (subscription.key === undefined) {
    if (!isSelector(subscription.when)) return new Map()
    return new Map(matching(subscription.when, events).map(candidate => [candidate.event.id, [candidate]]))
  }
  const groups = new Map<string, ObservedEvent[]>()
  for (const candidate of events) {
    const value = readKey(candidate.event as unknown as Record<string, unknown>, subscription.key)
    if (value === undefined) continue
    const key = stableStringify(value)
    const current = groups.get(key) ?? []
    current.push(candidate)
    groups.set(key, current)
  }
  return groups
}

function readKey(event: Record<string, unknown>, expression: string): unknown {
  let current: unknown = event
  for (const part of expression.slice(2).split('.')) {
    if (!record(current) || !Object.hasOwn(current, part)) return undefined
    current = current[part]
  }
  if (current === undefined || typeof current === 'function' || typeof current === 'symbol' || typeof current === 'bigint') return undefined
  return current
}

function evaluateOne(expression: EventExpression, events: readonly ObservedEvent[]): readonly ObservedEvent[] | null {
  if (isSelector(expression)) return matching(expression, events).slice(0, 1).length === 0 ? null : matching(expression, events).slice(0, 1)
  if ('all' in expression) {
    const parts = expression.all.map(child => evaluateOne(child, events))
    return parts.some(part => part === null) ? null : parts.flatMap(part => part ?? [])
  }
  if ('any' in expression) {
    for (const child of expression.any) {
      const match = evaluateOne(child, events)
      if (match !== null) return match
    }
    return null
  }
  if ('count' in expression) {
    const matches = matching(expression.count.selector, events)
    // Activation is an append-only fact: recover the earliest prefix at which
    // the predicate became true, even if later events make an exact/lte view false.
    const satisfied = expression.count.operator === 'lte'
      ? matches.length > 0 && expression.count.value > 0
      : matches.length >= expression.count.value
    if (!satisfied) return null
    return matches.slice(0, expression.count.operator === 'lte' ? 1 : expression.count.value)
  }
  let nextSeq = -1
  let subject: string | undefined
  const selected: ObservedEvent[] = []
  for (const selector of expression.sequence) {
    const candidate = events.find(event => {
      const ref = eventRef(event.event)
      return matchesSelector(selector, event) && (subject === undefined || ref.subject === subject) && ref.seq > nextSeq
    })
    if (candidate === undefined) return null
    const ref = eventRef(candidate.event)
    subject = ref.subject
    nextSeq = ref.seq
    selected.push(candidate)
  }
  return selected
}

function inspect(expression: EventExpression, events: readonly ObservedEvent[]): EventConditionInspection {
  if (isSelector(expression)) {
    const matches = matching(expression, events).map(toSource)
    return { kind: 'event', satisfied: matches.length > 0, selector: expression, matches }
  }
  if ('all' in expression || 'any' in expression) {
    const kind = 'all' in expression ? 'all' as const : 'any' as const
    const children = 'all' in expression ? expression.all : expression.any
    const expressions = children.map(child => inspect(child, events))
    return { kind, satisfied: kind === 'all' ? expressions.every(child => child.satisfied) : expressions.some(child => child.satisfied), expressions }
  }
  if ('count' in expression) {
    const matches = matching(expression.count.selector, events).map(toSource)
    const satisfied = expression.count.operator === 'eq' ? matches.length === expression.count.value : expression.count.operator === 'gte' ? matches.length >= expression.count.value : matches.length <= expression.count.value
    return { kind: 'count', satisfied, selector: expression.count.selector, operator: expression.count.operator, value: expression.count.value, matches }
  }
  let nextSeq = -1
  let subject: string | undefined
  const steps = expression.sequence.map(selector => {
    const candidate = events.find(event => {
      const ref = eventRef(event.event)
      return matchesSelector(selector, event) && (subject === undefined || ref.subject === subject) && ref.seq > nextSeq
    })
    if (candidate === undefined) return { selector }
    const ref = eventRef(candidate.event)
    subject = ref.subject
    nextSeq = ref.seq
    return { selector, match: toSource(candidate) }
  })
  return { kind: 'sequence', satisfied: steps.every(step => step.match !== undefined), steps }
}

function matching(selector: EventSelector, events: readonly ObservedEvent[]): readonly ObservedEvent[] {
  return events.filter(event => matchesSelector(selector, event))
}

function matchesSelector(selector: EventSelector, observed: ObservedEvent): boolean {
  return selector.role === observed.role
    && selector.event === observed.event.name
    && (selector.payload === undefined || partialMatch(selector.payload, observed.event.payload))
}

function partialMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => partialMatch(value, actual[index]))
  if (record(expected)) return record(actual) && Object.entries(expected).every(([key, value]) => partialMatch(value, actual[key]))
  return Object.is(expected, actual)
}

function normalizeSources(events: readonly ObservedEvent[]): readonly ActivationSource[] {
  const unique = new Map<string, ActivationSource>()
  for (const event of events) {
    const source = toSource(event)
    unique.set(`${source.ref.subject}\0${source.ref.seq}\0${source.ref.id}`, source)
  }
  return [...unique.values()].sort((left, right) => compareRef(left.ref, right.ref))
}

function toSource(event: ObservedEvent): ActivationSource {
  return { role: event.role, ref: eventRef(event.event) }
}

function sortObserved(events: readonly ObservedEvent[]): readonly ObservedEvent[] {
  // Deterministic normalization only. Cross-stream order is never interpreted as causality.
  return [...events].sort((left, right) => compareRef(eventRef(left.event), eventRef(right.event)))
}

function compareRef(left: { subject: string; seq: number; id: string }, right: { subject: string; seq: number; id: string }): number {
  return left.subject.localeCompare(right.subject) || left.seq - right.seq || left.id.localeCompare(right.id)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
