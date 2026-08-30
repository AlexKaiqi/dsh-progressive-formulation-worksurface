import { WorkSurfaceError } from './error.ts'
import { sha256, stableStringify } from './hash.ts'

/** Lossless JSON accepted at every durable WorkSurface boundary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type SurfaceId = string
export type OrchestrationId = string
export type RegistrationId = string
export type ActivationId = string
export type Revision = `sha256:${string}`
export type SubjectKey = `surface:${string}` | `registration:${string}`

export interface EventSubject {
  readonly kind: 'surface' | 'registration'
  readonly id: string
}

/** Public event address. Storage-adapter identities never cross this boundary. */
export interface EventRef {
  readonly subject: SubjectKey
  readonly seq: number
  readonly id: string
}

export interface EventMeta {
  /** DSH execution evidence. Session/Turn remain owned by DSH. */
  readonly sessionId?: string
  readonly turn?: number
  readonly registrationId?: RegistrationId
  readonly activationId?: ActivationId
  readonly operationKey?: string
  readonly definitionRevision?: Revision
  readonly inputSource?: 'published' | 'authoring' | 'revision'
  readonly inputRevision?: Revision
  readonly expectedHead?: Revision | null
  readonly outputRevision?: Revision
}

/** Append intent before a stream allocates seq and recordedAt. */
export interface EventDraft {
  readonly id: string
  readonly name: string
  readonly payload: JsonValue
  readonly causes?: readonly EventRef[]
  readonly meta?: EventMeta
}

/** One append-only process fact in a Surface or Registration stream. */
export interface WorkSurfaceEvent extends EventDraft {
  readonly version: 1
  readonly subject: EventSubject
  readonly seq: number
  readonly causes: readonly EventRef[]
  readonly meta: EventMeta
  readonly recordedAt: string
}

export interface EventSelector {
  readonly role: string
  readonly event: string
  /** Recursive partial JSON match. */
  readonly payload?: JsonValue
}

export type EventExpression = EventSelector
  | { readonly all: readonly EventExpression[] }
  | { readonly any: readonly EventExpression[] }
  | {
    readonly count: {
      readonly selector: EventSelector
      readonly operator: 'eq' | 'gte' | 'lte'
      readonly value: number
    }
  }
  | { readonly sequence: readonly EventSelector[] }

export interface EmitAction {
  readonly role: string
  readonly event: string
  readonly payload: JsonValue
  readonly operationKey: string
}

export interface EmitReaction {
  readonly emit: readonly EmitAction[]
}

export interface FollowupAction {
  readonly role: string
  readonly message: string
  readonly operationKey: string
}

export interface FollowupReaction {
  readonly followup: readonly FollowupAction[]
}

export type DeclarativeReaction = EmitReaction | FollowupReaction

export interface HandlerSpec {
  readonly command: 'bash' | 'zsh' | 'python3' | 'node'
  readonly path: string
  readonly args?: readonly string[]
  readonly reads: readonly string[]
  readonly emits: readonly string[]
}

export interface CodeReaction {
  readonly handler: HandlerSpec
}

export interface SubscriptionDefinition {
  readonly id: string
  readonly history: 'all' | 'from-registration'
  readonly key?: string
  readonly when: EventExpression
  readonly reaction: DeclarativeReaction | CodeReaction
}

export interface OrchestrationDefinition {
  readonly version: 1
  readonly roles: readonly string[]
  readonly subscriptions: readonly SubscriptionDefinition[]
}

export interface StoredDefinition {
  readonly revision: Revision
  readonly definition: OrchestrationDefinition
}

export interface Registration {
  readonly id: RegistrationId
  readonly orchestrationId: OrchestrationId
  readonly definitionRevision: Revision
  readonly bindings: Readonly<Record<string, SurfaceId>>
  /** Per-role next seq at registration; used by from-registration subscriptions. */
  readonly historyBoundary: Readonly<Record<string, number>>
  readonly capabilityPolicy: { readonly targetRoles: readonly string[] }
}

/** Event annotated only for deterministic subscription matching. */
export interface ObservedEvent {
  readonly role: string
  readonly event: WorkSurfaceEvent
  readonly afterRegistration: boolean
}

export interface ActivationSource {
  readonly role: string
  readonly ref: EventRef
}

export interface OrchestrationActivation {
  readonly id: ActivationId
  readonly subscriptionId: string
  readonly key: string
  readonly sources: readonly ActivationSource[]
}

/** Durable Registration-stream facts used for exactly-once reconciliation. */
export type OrchestrationRecord =
  | { readonly kind: 'registered'; readonly registration: Registration }
  | { readonly kind: 'status'; readonly status: 'active' | 'paused' | 'retired' }
  | { readonly kind: 'activation-opened'; readonly activation: OrchestrationActivation }
  | { readonly kind: 'handler-invoked'; readonly activationId: ActivationId; readonly invocation: number }
  | { readonly kind: 'activation-settled'; readonly activationId: ActivationId }
  | {
    readonly kind: 'operation-recorded'
    readonly activationId: ActivationId
    readonly operationKey: string
    readonly targetRole: string
    readonly targetSubject?: SubjectKey
    readonly event?: EventDraft
    readonly message?: string
  }
  | {
    readonly kind: 'operation-settled'
    readonly activationId: ActivationId
    readonly operationKey: string
    readonly targetRole: string
    readonly target: EventRef | { readonly sessionId: string; readonly messageId: string }
  }
  | { readonly kind: 'handler-failed'; readonly activationId: ActivationId; readonly message: string }

export interface OrchestrationState {
  readonly registration: Registration | null
  readonly status: 'unregistered' | 'active' | 'paused' | 'retired'
  readonly activations: ReadonlyMap<ActivationId, OrchestrationActivation>
  readonly recordedOperations: ReadonlyMap<string, Extract<OrchestrationRecord, { kind: 'operation-recorded' }>>
  readonly settledOperations: ReadonlyMap<string, Extract<OrchestrationRecord, { kind: 'operation-settled' }>>
  readonly settledActivations: ReadonlySet<ActivationId>
  readonly handlerInvocations: ReadonlyMap<ActivationId, number>
}

export function surfaceSubject(id: SurfaceId): EventSubject {
  requireId(id, 'Surface id')
  return { kind: 'surface', id }
}

export function registrationSubject(id: RegistrationId): EventSubject {
  requireId(id, 'Registration id')
  return { kind: 'registration', id }
}

export function subjectKey(subject: EventSubject): SubjectKey {
  validateSubject(subject)
  return `${subject.kind}:${subject.id}` as SubjectKey
}

export function eventRef(event: WorkSurfaceEvent): EventRef {
  return { subject: subjectKey(event.subject), seq: event.seq, id: event.id }
}

/** Validate, detach, and content-address one exact orchestration program. */
export function defineOrchestration(input: unknown): StoredDefinition {
  assertJson(input, 'Definition')
  const definition = structuredClone(input) as unknown as OrchestrationDefinition
  validateDefinition(definition)
  return {
    revision: `sha256:${sha256(stableStringify(definition))}`,
    definition: deepFreeze(definition),
  }
}

/** Stable identity for one managed target append. */
export function emissionEventId(
  registrationId: RegistrationId,
  activationId: ActivationId,
  operationKey: string,
  target: SubjectKey,
): string {
  requireId(registrationId, 'Registration id')
  requireId(activationId, 'Activation id')
  requireText(operationKey, 'operation key')
  validateSubjectKey(target)
  return `evt_${sha256(`${registrationId}\0${activationId}\0${operationKey}\0${target}`).slice(0, 40)}`
}

export function publicationEventId(sessionId: string, turn: number, surfaceId: SurfaceId, outputRevision: Revision): string {
  requireText(sessionId, 'Session id')
  if (!Number.isSafeInteger(turn) || turn < 0) throw invalid('turn must be a non-negative safe integer')
  requireId(surfaceId, 'Surface id')
  validateRevision(outputRevision)
  return `evt_${sha256(`${sessionId}\0${turn}\0${surfaceId}\0${outputRevision}`).slice(0, 40)}`
}

/** Fold only Registration-stream records. Cache or wall-clock state is irrelevant. */
export function foldOrchestration(records: readonly OrchestrationRecord[]): OrchestrationState {
  let registration: Registration | null = null
  let status: OrchestrationState['status'] = 'unregistered'
  const activations = new Map<ActivationId, OrchestrationActivation>()
  const recordedOperations = new Map<string, Extract<OrchestrationRecord, { kind: 'operation-recorded' }>>()
  const settledOperations = new Map<string, Extract<OrchestrationRecord, { kind: 'operation-settled' }>>()
  const settledActivations = new Set<ActivationId>()
  const handlerInvocations = new Map<ActivationId, number>()

  for (const record of records) {
    switch (record.kind) {
      case 'registered':
        if (registration !== null) throw corrupt('Registration stream contains multiple registrations')
        validateRegistration(record.registration)
        registration = deepFreeze(structuredClone(record.registration))
        status = 'active'
        break
      case 'status':
        if (registration === null) throw corrupt('status precedes registration')
        status = record.status
        break
      case 'activation-opened': {
        const previous = activations.get(record.activation.id)
        if (previous !== undefined && stableStringify(previous) !== stableStringify(record.activation)) throw corrupt(`conflicting activation '${record.activation.id}'`)
        activations.set(record.activation.id, record.activation)
        break
      }
      case 'operation-recorded': {
        const key = operationIdentity(record.activationId, record.operationKey)
        const previous = recordedOperations.get(key)
        if (previous !== undefined && stableStringify(previous) !== stableStringify(record)) throw corrupt(`conflicting operation '${key}'`)
        recordedOperations.set(key, record)
        break
      }
      case 'operation-settled': {
        const key = operationIdentity(record.activationId, record.operationKey)
        if (!recordedOperations.has(key)) throw corrupt(`operation '${key}' settled without a record`)
        const previous = settledOperations.get(key)
        if (previous !== undefined && stableStringify(previous) !== stableStringify(record)) throw corrupt(`conflicting settlement '${key}'`)
        settledOperations.set(key, record)
        break
      }
      case 'handler-invoked':
        handlerInvocations.set(record.activationId, Math.max(record.invocation, handlerInvocations.get(record.activationId) ?? 0))
        break
      case 'activation-settled':
        settledActivations.add(record.activationId)
        break
      case 'handler-failed':
        break
    }
  }
  return { registration, status, activations, recordedOperations, settledOperations, settledActivations, handlerInvocations }
}

export function validateEventDraft(draft: EventDraft): void {
  if (!plainObject(draft)) throw invalid('event draft must be an object')
  requireText(draft.id, 'event id')
  requireName(draft.name, 'event name')
  assertJson(draft.payload, 'event payload')
  for (const cause of draft.causes ?? []) validateEventRef(cause)
  if (draft.meta !== undefined) validateEventMeta(draft.meta)
}

export function validateWorkSurfaceEvent(event: WorkSurfaceEvent): void {
  validateEventDraft(event)
  if (event.version !== 1) throw invalid('event version must be 1')
  validateSubject(event.subject)
  if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw invalid('event seq must be a non-negative safe integer')
  if (!Array.isArray(event.causes)) throw invalid('event causes must be an array')
  if (!plainObject(event.meta)) throw invalid('event meta must be an object')
  if (typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt))) throw invalid('recordedAt must be an ISO timestamp')
}

export function validateEventRef(ref: EventRef): void {
  if (!plainObject(ref)) throw invalid('EventRef must be an object')
  validateSubjectKey(ref.subject)
  if (!Number.isSafeInteger(ref.seq) || ref.seq < 0) throw invalid('EventRef seq must be non-negative')
  requireText(ref.id, 'EventRef id')
}

export function validateRegistration(registration: Registration): void {
  if (!plainObject(registration)) throw invalid('Registration must be an object')
  requireId(registration.id, 'Registration id')
  requireId(registration.orchestrationId, 'Orchestration id')
  validateRevision(registration.definitionRevision)
  if (!plainObject(registration.bindings) || !plainObject(registration.historyBoundary)) throw invalid('Registration bindings and historyBoundary must be objects')
  const roles = Object.keys(registration.bindings)
  if (roles.length === 0) throw invalid('Registration must bind at least one role')
  for (const role of roles) {
    requireName(role, 'bound role')
    requireId(registration.bindings[role]!, `Surface bound to '${role}'`)
    const boundary = registration.historyBoundary[role]
    if (boundary === undefined || !Number.isSafeInteger(boundary) || boundary < 0) throw invalid(`history boundary for '${role}' must be non-negative`)
  }
  if (!plainObject(registration.capabilityPolicy) || !Array.isArray(registration.capabilityPolicy.targetRoles)) throw invalid('Registration capability policy is invalid')
  for (const role of registration.capabilityPolicy.targetRoles) if (!roles.includes(role)) throw invalid(`capability target role '${role}' is not bound`)
}

function validateDefinition(definition: OrchestrationDefinition): void {
  if (!plainObject(definition) || definition.version !== 1) throw invalid('Definition version must be 1')
  if (!Array.isArray(definition.roles) || definition.roles.length === 0) throw invalid('Definition roles must be a non-empty array')
  const roles = new Set<string>()
  for (const role of definition.roles) {
    requireName(role, 'role')
    if (roles.has(role)) throw invalid(`duplicate role '${role}'`)
    roles.add(role)
  }
  if (!Array.isArray(definition.subscriptions) || definition.subscriptions.length === 0) throw invalid('Definition subscriptions must be non-empty')
  const subscriptionIds = new Set<string>()
  for (const candidate of definition.subscriptions) {
    if (!plainObject(candidate)) throw invalid('subscription must be an object')
    const subscription = candidate as unknown as SubscriptionDefinition
    requireName(subscription.id, 'subscription id')
    if (subscriptionIds.has(subscription.id)) throw invalid(`duplicate subscription '${subscription.id}'`)
    subscriptionIds.add(subscription.id)
    if (subscription.history !== 'all' && subscription.history !== 'from-registration') throw invalid(`subscription '${subscription.id}' must declare history`)
    validateExpression(subscription.when, roles)
    if (requiresActivationKey(subscription.when) && (subscription.key === undefined || subscription.key.trim() === '')) throw invalid(`subscription '${subscription.id}' must declare an activation key`)
    if (subscription.key !== undefined) validateKeyExpression(subscription.key)
    validateReaction(subscription.reaction, roles, subscription.id)
  }
}

function validateExpression(expression: EventExpression, roles: ReadonlySet<string>): void {
  if (!plainObject(expression)) throw invalid('event condition must be an object')
  if (isSelector(expression)) {
    if (!roles.has(expression.role)) throw invalid(`unknown role '${expression.role}'`)
    requireName(expression.event, 'selected event')
    if (expression.payload !== undefined) assertJson(expression.payload, 'selector payload')
    return
  }
  if ('all' in expression || 'any' in expression) {
    const children = 'all' in expression ? expression.all : expression.any
    if (!Array.isArray(children) || children.length === 0) throw invalid('all/any condition must be non-empty')
    children.forEach(child => validateExpression(child, roles))
    return
  }
  if ('count' in expression) {
    if (!plainObject(expression.count)) throw invalid('count condition must be an object')
    validateExpression(expression.count.selector, roles)
    if (!['eq', 'gte', 'lte'].includes(expression.count.operator)) throw invalid('count operator is invalid')
    if (!Number.isSafeInteger(expression.count.value) || expression.count.value < 0) throw invalid('count value must be non-negative')
    return
  }
  if ('sequence' in expression) {
    if (!Array.isArray(expression.sequence) || expression.sequence.length === 0) throw invalid('sequence must be non-empty')
    expression.sequence.forEach(selector => validateExpression(selector, roles))
    if (new Set(expression.sequence.map(selector => selector.role)).size !== 1) throw invalid('cross-stream sequence requires explicit causes and is not accepted by declarative v1')
    return
  }
  throw invalid('unknown event condition')
}

function validateReaction(reaction: DeclarativeReaction | CodeReaction, roles: ReadonlySet<string>, subscriptionId: string): void {
  if (!plainObject(reaction)) throw invalid(`reaction for '${subscriptionId}' must be an object`)
  if ('emit' in reaction) {
    if (!Array.isArray(reaction.emit) || reaction.emit.length === 0) throw invalid(`reaction '${subscriptionId}' emits nothing`)
    const keys = new Set<string>()
    for (const candidate of reaction.emit) {
      if (!plainObject(candidate)) throw invalid(`reaction '${subscriptionId}' contains an invalid emit`)
      const action = candidate as unknown as EmitAction
      if (!roles.has(action.role)) throw invalid(`reaction '${subscriptionId}' emits to unknown role '${action.role}'`)
      requireName(action.event, 'emitted event')
      requireText(action.operationKey, 'operation key')
      if (keys.has(action.operationKey)) throw invalid(`duplicate operation key '${action.operationKey}'`)
      keys.add(action.operationKey)
      assertJson(action.payload, 'emitted payload')
    }
    return
  }
  if ('followup' in reaction) {
    if (!Array.isArray(reaction.followup) || reaction.followup.length === 0) throw invalid(`reaction '${subscriptionId}' has no followup`)
    const keys = new Set<string>()
    for (const candidate of reaction.followup) {
      if (!plainObject(candidate)) throw invalid(`reaction '${subscriptionId}' contains an invalid followup`)
      const action = candidate as unknown as FollowupAction
      if (!roles.has(action.role)) throw invalid(`reaction '${subscriptionId}' follows up unknown role '${action.role}'`)
      requireText(action.message, 'followup message')
      requireText(action.operationKey, 'operation key')
      if (keys.has(action.operationKey)) throw invalid(`duplicate operation key '${action.operationKey}'`)
      keys.add(action.operationKey)
    }
    return
  }
  if ('handler' in reaction) {
    if (!plainObject(reaction.handler)) throw invalid(`handler for '${subscriptionId}' must be an object`)
    const handler = reaction.handler as HandlerSpec
    if (!['bash', 'zsh', 'python3', 'node'].includes(handler.command)) throw invalid(`handler for '${subscriptionId}' uses an unsupported command`)
    validateRelativePath(handler.path, 'handler path')
    if (handler.args !== undefined && (!Array.isArray(handler.args) || handler.args.some(value => typeof value !== 'string'))) throw invalid('handler args must be strings')
    for (const list of [handler.reads, handler.emits]) {
      if (!Array.isArray(list)) throw invalid('handler reads/emits must be arrays')
      for (const role of list) if (!roles.has(role)) throw invalid(`handler references unknown role '${role}'`)
      if (new Set(list).size !== list.length) throw invalid('handler reads/emits contain duplicates')
    }
    if (handler.emits.length === 0) throw invalid('handler must declare at least one emit role')
    return
  }
  throw invalid(`reaction for '${subscriptionId}' must contain emit, followup, or handler`)
}

export function expressionRoles(expression: EventExpression): readonly string[] {
  if (isSelector(expression)) return [expression.role]
  if ('count' in expression) return [expression.count.selector.role]
  if ('sequence' in expression) return [...new Set(expression.sequence.map(selector => selector.role))]
  const children = 'all' in expression ? expression.all : expression.any
  return [...new Set(children.flatMap(expressionRoles))]
}

export function isSelector(expression: EventExpression): expression is EventSelector {
  return 'role' in expression && 'event' in expression
}

export function requiresActivationKey(expression: EventExpression): boolean {
  return !isSelector(expression)
}

export function operationIdentity(activationId: ActivationId, operationKey: string): string {
  return `${activationId}\0${operationKey}`
}

function validateEventMeta(meta: EventMeta): void {
  if (!plainObject(meta)) throw invalid('event meta must be an object')
  for (const [key, value] of Object.entries(meta)) {
    if (!['sessionId', 'turn', 'registrationId', 'activationId', 'operationKey', 'definitionRevision', 'inputSource', 'inputRevision', 'expectedHead', 'outputRevision'].includes(key)) throw invalid(`unknown event meta field '${key}'`)
    if (value === null && key === 'expectedHead') continue
    if (key === 'turn') {
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid('event meta turn must be a non-negative safe integer')
    } else if (key.endsWith('Revision') || key === 'expectedHead') validateRevision(String(value))
    else if (key === 'inputSource') {
      if (!['published', 'authoring', 'revision'].includes(String(value))) throw invalid('invalid inputSource')
    } else requireText(String(value), `event meta ${key}`)
  }
}

function validateSubject(subject: EventSubject): void {
  if (!plainObject(subject) || !['surface', 'registration'].includes(subject.kind)) throw invalid('event subject is invalid')
  requireId(subject.id, 'subject id')
}

function validateSubjectKey(value: string): asserts value is SubjectKey {
  if (!/^(surface|registration):[^\s:][^\s]*$/.test(value)) throw invalid(`invalid subject '${value}'`)
}

function validateRevision(value: string): asserts value is Revision {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw invalid(`invalid revision '${value}'`)
}

function validateKeyExpression(value: string): void {
  if (!/^\$\.(payload|meta)(\.[A-Za-z0-9_-]+)+$/.test(value)) throw invalid(`unsupported activation key expression '${value}'`)
}

function validateRelativePath(value: string, label: string): void {
  requireText(value, label)
  if (value.includes('\\') || value.startsWith('/') || value.split('/').some(part => part === '' || part === '.' || part === '..')) throw invalid(`${label} must be a normalized relative path`)
}

export function assertJson(value: unknown, label: string): asserts value is JsonValue {
  const seen = new Set<object>()
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return
    if (typeof candidate === 'number' && Number.isFinite(candidate) && !Object.is(candidate, -0)) return
    if (Array.isArray(candidate)) {
      if (seen.has(candidate)) throw invalid(`${label} must not contain cycles`)
      seen.add(candidate)
      for (let index = 0; index < candidate.length; index += 1) {
        if (!(index in candidate)) throw invalid(`${label} must not contain sparse arrays`)
        visit(candidate[index])
      }
      seen.delete(candidate)
      return
    }
    if (plainObject(candidate)) {
      if (seen.has(candidate)) throw invalid(`${label} must not contain cycles`)
      seen.add(candidate)
      for (const child of Object.values(candidate)) {
        if (child === undefined) throw invalid(`${label} must not contain undefined`)
        visit(child)
      }
      seen.delete(candidate)
      return
    }
    throw invalid(`${label} must be lossless JSON`)
  }
  visit(value)
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${label} must not be blank`)
}

function requireName(value: string, label: string): void {
  requireText(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw invalid(`${label} '${value}' is invalid`)
}

function requireId(value: string, label: string): void {
  requireName(value, label)
  if (value.includes(':')) throw invalid(`${label} must not contain ':'`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function invalid(message: string): WorkSurfaceError {
  return new WorkSurfaceError('invalid-definition', message)
}

function corrupt(message: string): WorkSurfaceError {
  return new WorkSurfaceError('canonical-corrupt', message)
}
