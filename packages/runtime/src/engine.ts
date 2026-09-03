import {
  DefinitionStore,
  WorkSurfaceError,
  deriveActivations,
  emissionEventId,
  eventRef,
  foldOrchestration,
  inspectEventCondition,
  projectActualFlow,
  projectPlannedFlow,
  registrationSubject,
  sha256,
  stableStringify,
  subscriptionFor,
  surfaceSubject,
  type ActualFlowEdge,
  type EventDraft,
  type EventRef,
  type HandlerSpec,
  type HostOperationReceipt,
  type JsonValue,
  type ObservedEvent,
  type OrchestrationActivation,
  type OrchestrationDefinition,
  type OrchestrationRecord,
  type PlannedFlowEdge,
  type Registration,
  type RegistrationId,
  type Revision,
  type WorkSurfaceEvent,
} from '@pf-worksurface/core'

/** The engine addresses Surfaces; a host adapter owns followup delivery. */
export interface WorkSurfaceEventPort {
  appendSurface(surfaceId: string, draft: EventDraft): Promise<EventRef>
  replaySurface(surfaceId: string, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]>
  appendRegistration(registrationId: string, draft: EventDraft): Promise<EventRef>
  replayRegistration(registrationId: string, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]>
  followupSurface?(surfaceId: string, message: string, requestId: string): Promise<HostOperationReceipt>
}

export interface CodeHandlerEmit {
  readonly targetRole: string
  readonly name: string
  readonly payload: JsonValue
  readonly operationKey: string
}

interface ManagedEmit extends CodeHandlerEmit { readonly kind: 'emit' }
interface ManagedFollowup { readonly kind: 'followup'; readonly targetRole: string; readonly message: string; readonly operationKey: string }
type ManagedOperation = ManagedEmit | ManagedFollowup

export interface CodeHandlerRunner {
  run(input: {
    readonly registration: Registration
    readonly activation: OrchestrationActivation
    readonly matches: readonly ObservedEvent[]
    readonly bindings: Readonly<Record<string, string>>
    readonly handler: HandlerSpec
  }): Promise<readonly CodeHandlerEmit[]>
}

export interface SubscriptionInspection {
  readonly id: string
  readonly history: 'all' | 'from-registration'
  readonly key?: string
  readonly condition: ReturnType<typeof inspectEventCondition>
  readonly activationCount: number
}

export interface OrchestrationOperationInspection {
  readonly operationKey: string
  readonly targetRole: string
  readonly targetSubject?: string
  readonly event?: EventDraft
  readonly message?: string
  readonly status: 'recorded' | 'settled'
  readonly target?: EventRef | HostOperationReceipt
}

export interface OrchestrationRunInspection {
  readonly activation: OrchestrationActivation
  readonly status: 'running' | 'retryable-failure' | 'settled'
  readonly handlerInvocations: number
  readonly failures: readonly string[]
  readonly operations: readonly OrchestrationOperationInspection[]
}

export interface OrchestrationInspection {
  readonly orchestrationId: string
  readonly registrationId: RegistrationId
  readonly definitionRevision: Revision
  readonly definition: OrchestrationDefinition
  readonly status: 'active' | 'paused' | 'retired'
  readonly bindings: Readonly<Record<string, string>>
  readonly planned: readonly PlannedFlowEdge[]
  readonly actual: readonly ActualFlowEdge[]
  readonly activations: readonly OrchestrationActivation[]
  readonly pendingOperations: readonly string[]
  readonly subscriptions: readonly SubscriptionInspection[]
  readonly runs: readonly OrchestrationRunInspection[]
}

/** Replay-only orchestration engine over exact Definition revisions. */
export class WorkSurfaceEngine {
  private readonly running = new Map<string, Promise<void>>()

  constructor(
    private readonly definitions: DefinitionStore,
    private readonly events: WorkSurfaceEventPort,
    private readonly codeHandlers: CodeHandlerRunner,
  ) {}

  async register(input: {
    readonly orchestrationId: string
    readonly registrationId: RegistrationId
    readonly definitionRevision: Revision
    readonly definition: OrchestrationDefinition
    readonly bindings: Readonly<Record<string, string>>
  }): Promise<{ orchestrationId: string; registrationId: RegistrationId; definitionRevision: Revision }> {
    const stored = await this.definitions.putRevision(input.definitionRevision, input.definition)
    validateBindings(stored.definition, input.bindings)
    await this.serializeRegistration(input.registrationId, async () => {
      const existingEvents = await this.events.replayRegistration(input.registrationId)
      if (existingEvents.length > 0) {
        const existing = requireRegistration(foldOrchestration(existingEvents.map(event => event.payload as unknown as OrchestrationRecord)).registration)
        if (existing.orchestrationId !== input.orchestrationId
          || existing.definitionRevision !== input.definitionRevision
          || stableStringify(existing.bindings) !== stableStringify(input.bindings)
          || stableStringify(existing.capabilityPolicy.targetRoles) !== stableStringify(targetRoles(stored.definition))) {
          throw new WorkSurfaceError('already-exists-conflict', `Registration '${input.registrationId}' already fixes different orchestration facts`)
        }
        return
      }

      const historyBoundary: Record<string, number> = {}
      for (const [role, surfaceId] of Object.entries(input.bindings)) historyBoundary[role] = (await this.events.replaySurface(surfaceId)).length
      const registration: Registration = {
        id: input.registrationId,
        orchestrationId: input.orchestrationId,
        definitionRevision: input.definitionRevision,
        bindings: structuredClone(input.bindings),
        historyBoundary,
        capabilityPolicy: { targetRoles: targetRoles(stored.definition) },
      }
      await this.appendRecord(input.registrationId, { kind: 'registered', registration })
    })
    await this.reconcile(input.registrationId)
    return { orchestrationId: input.orchestrationId, registrationId: input.registrationId, definitionRevision: input.definitionRevision }
  }

  async pause(registrationId: string): Promise<void> { await this.transition(registrationId, 'paused') }
  async resume(registrationId: string): Promise<void> { await this.transition(registrationId, 'active'); await this.reconcile(registrationId) }
  async retire(registrationId: string): Promise<void> { await this.transition(registrationId, 'retired') }

  reconcile(registrationId: string): Promise<void> {
    return this.serializeRegistration(registrationId, () => this.reconcileOnce(registrationId))
  }

  private serializeRegistration<T>(registrationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.running.get(registrationId) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.running.set(registrationId, settled)
    void settled.finally(() => { if (this.running.get(registrationId) === settled) this.running.delete(registrationId) })
    return result
  }

  async inspect(registrationId: string): Promise<OrchestrationInspection> {
    const loaded = await this.load(registrationId)
    const registration = requireRegistration(loaded.state.registration)
    const observed = await this.observe(registration)
    const pendingOperations = [...loaded.state.recordedOperations.keys()].filter(key => !loaded.state.settledOperations.has(key))
    return {
      orchestrationId: registration.orchestrationId,
      registrationId,
      definitionRevision: registration.definitionRevision,
      definition: loaded.definition,
      status: loaded.state.status === 'unregistered' ? 'retired' : loaded.state.status,
      bindings: registration.bindings,
      planned: projectPlannedFlow(loaded.definition),
      actual: projectActualFlow(loaded.records),
      activations: [...loaded.state.activations.values()],
      pendingOperations,
      subscriptions: loaded.definition.subscriptions.map(subscription => ({
        id: subscription.id,
        history: subscription.history,
        ...(subscription.key === undefined ? {} : { key: subscription.key }),
        condition: inspectEventCondition(subscription.when, subscription.history === 'all' ? observed : observed.filter(event => event.afterRegistration)),
        activationCount: [...loaded.state.activations.values()].filter(activation => activation.subscriptionId === subscription.id).length,
      })),
      runs: inspectRuns(loaded.records, loaded.state),
    }
  }

  private async reconcileOnce(registrationId: string): Promise<void> {
    let loaded = await this.load(registrationId)
    if (loaded.state.status !== 'active') return
    await this.recoverRecorded(registrationId, loaded.records)
    loaded = await this.load(registrationId)
    const registration = requireRegistration(loaded.state.registration)
    const observed = await this.observe(registration)
    const activations = deriveActivations(registrationId, loaded.definition, observed, new Set(loaded.state.activations.keys()))
    for (const activation of activations) await this.appendRecord(registrationId, { kind: 'activation-opened', activation })
    loaded = await this.load(registrationId)
    for (const activation of loaded.state.activations.values()) {
      if (loaded.state.settledActivations.has(activation.id)) continue
      if (failureNeedsExplicitRetry(loaded.records, activation.id)) continue
      const subscription = subscriptionFor(loaded.definition, activation)
      try {
        const actions: readonly ManagedOperation[] = 'emit' in subscription.reaction
          ? subscription.reaction.emit.map(action => ({
            kind: 'emit' as const,
            targetRole: action.role,
            name: action.event,
            payload: interpolate(action.payload, activation.key),
            operationKey: action.operationKey,
          }))
          : 'followup' in subscription.reaction
            ? subscription.reaction.followup.map(action => ({
              kind: 'followup' as const,
              targetRole: action.role,
              message: interpolateText(action.message, activation.key),
              operationKey: action.operationKey,
            }))
            : (await this.runHandler(registrationId, registration, activation, observed, subscription.reaction.handler, loaded.state.handlerInvocations.get(activation.id) ?? 0))
              .map(action => ({ ...action, kind: 'emit' as const }))
        const keys = new Set<string>()
        for (const action of actions) {
          if (keys.has(action.operationKey)) throw new WorkSurfaceError('effect-failed', `handler returned duplicate operation key '${action.operationKey}'`)
          keys.add(action.operationKey)
          if (!registration.capabilityPolicy.targetRoles.includes(action.targetRole)) throw new WorkSurfaceError('unauthorized', `operation targets unauthorized role '${action.targetRole}'`)
        }
        for (const action of actions) await this.managedOperation(registrationId, registration, activation, action)
        await this.appendRecord(registrationId, { kind: 'activation-settled', activationId: activation.id })
      } catch (error) {
        await this.appendRecord(registrationId, { kind: 'handler-failed', activationId: activation.id, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  private async runHandler(
    registrationId: string,
    registration: Registration,
    activation: OrchestrationActivation,
    observed: readonly ObservedEvent[],
    handler: HandlerSpec,
    invocations: number,
  ): Promise<readonly CodeHandlerEmit[]> {
    await this.appendRecord(registrationId, { kind: 'handler-invoked', activationId: activation.id, invocation: invocations + 1 })
    const matches = activation.sources.map(source => {
      const match = observed.find(candidate => {
        const ref = eventRef(candidate.event)
        return ref.subject === source.ref.subject && ref.seq === source.ref.seq && ref.id === source.ref.id
      })
      if (match === undefined) throw new WorkSurfaceError('canonical-corrupt', `activation source '${source.ref.subject}:${source.ref.seq}' cannot be replayed`)
      return match
    })
    return this.codeHandlers.run({ registration, activation, matches, bindings: registration.bindings, handler })
  }

  private async managedOperation(
    registrationId: string,
    registration: Registration,
    activation: OrchestrationActivation,
    action: ManagedOperation,
  ): Promise<void> {
    const loaded = await this.load(registrationId)
    const operationIdentity = `${activation.id}\0${action.operationKey}`
    if (loaded.state.settledOperations.has(operationIdentity)) return
    if (loaded.state.recordedOperations.has(operationIdentity)) {
      await this.recoverRecorded(registrationId, loaded.records)
      return
    }
    if (action.kind === 'followup') {
      const surfaceId = registration.bindings[action.targetRole]
      if (surfaceId === undefined) throw new WorkSurfaceError('invalid-definition', `unbound target role '${action.targetRole}'`)
      const targetSubject = `surface:${surfaceId}` as const
      const requestId = `worksurface:${sha256(`${registrationId}\0${activation.id}\0${action.operationKey}\0${targetSubject}`).slice(0, 40)}`
      await this.appendRecord(registrationId, {
        kind: 'operation-recorded', activationId: activation.id, operationKey: action.operationKey,
        targetRole: action.targetRole, targetSubject, message: action.message,
      })
      const target = await this.followup(surfaceId, action.message, requestId)
      await this.appendRecord(registrationId, {
        kind: 'operation-settled', activationId: activation.id, operationKey: action.operationKey,
        targetRole: action.targetRole, target,
      })
      return
    }
    const targetId = registration.bindings[action.targetRole]
    if (targetId === undefined) throw new WorkSurfaceError('invalid-definition', `unbound target role '${action.targetRole}'`)
    const target = `surface:${targetId}` as const
    const draft: EventDraft = {
      id: emissionEventId(registrationId, activation.id, action.operationKey, target),
      name: action.name,
      payload: action.payload,
      causes: activation.sources.map(source => source.ref),
      meta: {
        registrationId,
        activationId: activation.id,
        operationKey: action.operationKey,
        definitionRevision: registration.definitionRevision,
      },
    }
    await this.appendRecord(registrationId, {
      kind: 'operation-recorded', activationId: activation.id, operationKey: action.operationKey,
      targetRole: action.targetRole, targetSubject: target, event: draft,
    })
    const emitted = await this.events.appendSurface(targetId, draft)
    await this.appendRecord(registrationId, {
      kind: 'operation-settled', activationId: activation.id, operationKey: action.operationKey,
      targetRole: action.targetRole, target: emitted,
    })
  }

  private async recoverRecorded(registrationId: string, records: readonly OrchestrationRecord[]): Promise<void> {
    const state = foldOrchestration(records)
    for (const [key, operation] of state.recordedOperations) {
      if (state.settledOperations.has(key)) continue
      let target: EventRef | HostOperationReceipt
      if (operation.targetSubject !== undefined && operation.event !== undefined) {
        if (!operation.targetSubject.startsWith('surface:')) throw new WorkSurfaceError('canonical-corrupt', 'managed operation target is not a Surface')
        target = await this.events.appendSurface(operation.targetSubject.slice('surface:'.length), operation.event)
      } else if (operation.targetSubject !== undefined && operation.message !== undefined) {
        if (!operation.targetSubject.startsWith('surface:')) throw new WorkSurfaceError('canonical-corrupt', 'managed followup target is not a Surface')
        const requestId = `worksurface:${sha256(`${registrationId}\0${operation.activationId}\0${operation.operationKey}\0${operation.targetSubject}`).slice(0, 40)}`
        target = await this.followup(operation.targetSubject.slice('surface:'.length), operation.message, requestId)
      } else {
        throw new WorkSurfaceError('canonical-corrupt', 'managed operation has no valid target')
      }
      await this.appendRecord(registrationId, {
        kind: 'operation-settled', activationId: operation.activationId, operationKey: operation.operationKey,
        targetRole: operation.targetRole, target,
      })
    }
  }

  private followup(surfaceId: string, message: string, requestId: string): Promise<HostOperationReceipt> {
    if (this.events.followupSurface === undefined) throw new WorkSurfaceError('effect-failed', 'Surface Session followup routing is unavailable')
    return this.events.followupSurface(surfaceId, message, requestId)
  }

  private async observe(registration: Registration): Promise<readonly ObservedEvent[]> {
    const result: ObservedEvent[] = []
    for (const [role, surfaceId] of Object.entries(registration.bindings)) {
      for (const event of await this.events.replaySurface(surfaceId)) {
        result.push({ role, event, afterRegistration: event.seq >= registration.historyBoundary[role]! })
      }
    }
    return result
  }

  private async appendRecord(registrationId: string, record: OrchestrationRecord, idempotencyKey?: string): Promise<EventRef> {
    const stable = stableStringify(record)
    return this.events.appendRegistration(registrationId, {
      id: `evt_${stableHash(idempotencyKey ?? stable)}`,
      name: `registration.${record.kind}`,
      payload: structuredClone(record) as unknown as JsonValue,
      causes: record.kind === 'activation-opened' ? record.activation.sources.map(source => source.ref) : [],
    })
  }

  private async load(registrationId: string): Promise<{
    records: readonly OrchestrationRecord[]
    state: ReturnType<typeof foldOrchestration>
    definition: OrchestrationDefinition
  }> {
    const records = (await this.events.replayRegistration(registrationId)).map(event => event.payload as unknown as OrchestrationRecord)
    const state = foldOrchestration(records)
    const registration = requireRegistration(state.registration)
    const definition = (await this.definitions.get(registration.definitionRevision)).definition
    return { records, state, definition }
  }

  private async transition(registrationId: string, status: 'active' | 'paused' | 'retired'): Promise<void> {
    await this.serializeRegistration(registrationId, async () => {
      const loaded = await this.load(registrationId)
      if (loaded.state.status === 'retired' && status !== 'retired') throw new WorkSurfaceError('effect-failed', 'a retired Registration cannot resume')
      if (loaded.state.status !== status) {
        await this.appendRecord(registrationId, { kind: 'status', status }, `status\0${loaded.records.length}\0${status}`)
      }
    })
  }
}

function validateBindings(definition: OrchestrationDefinition, bindings: Readonly<Record<string, string>>): void {
  const actual = Object.keys(bindings).sort()
  const expected = [...definition.roles].sort()
  if (stableStringify(actual) !== stableStringify(expected)) throw new WorkSurfaceError('invalid-definition', 'bindings must name every Definition role exactly once')
  for (const [role, surfaceId] of Object.entries(bindings)) if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(surfaceId)) throw new WorkSurfaceError('invalid-id', `Surface bound to '${role}' is invalid`)
}

function failureNeedsExplicitRetry(records: readonly OrchestrationRecord[], activationId: string): boolean {
  const failure = records.findLastIndex(record => record.kind === 'handler-failed' && record.activationId === activationId)
  if (failure < 0) return false
  return records.findLastIndex(record => record.kind === 'status' && record.status === 'active') < failure
}

function targetRoles(definition: OrchestrationDefinition): readonly string[] {
  return [...new Set(definition.subscriptions.flatMap(subscription => 'emit' in subscription.reaction
    ? subscription.reaction.emit.map(action => action.role)
    : 'followup' in subscription.reaction
      ? subscription.reaction.followup.map(action => action.role)
      : subscription.reaction.handler.emits))].sort()
}

function inspectRuns(records: readonly OrchestrationRecord[], state: ReturnType<typeof foldOrchestration>): readonly OrchestrationRunInspection[] {
  const failures = new Map<string, string[]>()
  for (const record of records) if (record.kind === 'handler-failed') failures.set(record.activationId, [...(failures.get(record.activationId) ?? []), record.message])
  return [...state.activations.values()].map(activation => {
    const operations = [...state.recordedOperations.values()].filter(operation => operation.activationId === activation.id).map(operation => {
      const settled = state.settledOperations.get(`${activation.id}\0${operation.operationKey}`)
      return {
        operationKey: operation.operationKey,
        targetRole: operation.targetRole,
        ...(operation.targetSubject === undefined ? {} : { targetSubject: operation.targetSubject }),
        ...(operation.event === undefined ? {} : { event: operation.event }),
        ...(operation.message === undefined ? {} : { message: operation.message }),
        status: settled === undefined ? 'recorded' as const : 'settled' as const,
        ...(settled === undefined ? {} : { target: settled.target }),
      }
    })
    return {
      activation,
      status: state.settledActivations.has(activation.id) ? 'settled' as const : (failures.has(activation.id) ? 'retryable-failure' as const : 'running' as const),
      handlerInvocations: state.handlerInvocations.get(activation.id) ?? 0,
      failures: failures.get(activation.id) ?? [],
      operations,
    }
  })
}

function requireRegistration(registration: Registration | null): Registration {
  if (registration === null) throw new WorkSurfaceError('not-found', 'Registration does not exist')
  return registration
}

function interpolate(value: JsonValue, activationKey: string): JsonValue {
  if (typeof value === 'string') {
    const decoded = decodeActivationKey(activationKey)
    if (value === '${activation.key}') return structuredClone(decoded)
    return value.replaceAll('${activation.key}', typeof decoded === 'string' ? decoded : stableStringify(decoded))
  }
  if (Array.isArray(value)) return value.map(item => interpolate(item, activationKey))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, activationKey)]))
  return value
}

function decodeActivationKey(value: string): JsonValue {
  try { return JSON.parse(value) as JsonValue }
  catch { return value }
}

function interpolateText(value: string, activationKey: string): string {
  const decoded = decodeActivationKey(activationKey)
  return value.replaceAll('${activation.key}', typeof decoded === 'string' ? decoded : stableStringify(decoded))
}

function stableHash(value: string): string {
  return sha256(value).slice(0, 40)
}

export function createFileEventPort(store: {
  append(subject: ReturnType<typeof surfaceSubject> | ReturnType<typeof registrationSubject>, draft: EventDraft): Promise<EventRef>
  replay(subject: ReturnType<typeof surfaceSubject> | ReturnType<typeof registrationSubject>, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]>
}): WorkSurfaceEventPort {
  return {
    appendSurface: (id, draft) => store.append(surfaceSubject(id), draft),
    replaySurface: (id, from) => store.replay(surfaceSubject(id), from),
    appendRegistration: (id, draft) => store.append(registrationSubject(id), draft),
    replayRegistration: (id, from) => store.replay(registrationSubject(id), from),
  }
}
