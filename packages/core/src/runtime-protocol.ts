import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { WorkSurfaceError } from './error.ts'
import { sha256, stableStringify } from './hash.ts'
import type { JsonValue, Revision } from './event-model.ts'

export type AuthorityId = `wsa_${string}`
export type RuntimeLocalId = string
export type ContractDigest = `sha256:${string}`
export type RuntimeSubjectKind = 'surface' | 'dsh-session'
export type RuntimeProducerKind = 'surface-session' | 'orchestrate' | 'runtime' | 'dsh-adapter'
export type RuntimeCapability = 'consume' | 'orchestrate-emit' | 'surface-output'

export interface RuntimeAuthority { readonly version: 1; readonly id: AuthorityId }
export interface RuntimeScope {
  readonly authority: AuthorityId
  readonly kind: 'builtin' | 'registration'
  readonly id: RuntimeLocalId
}
export interface EventDeclaration {
  readonly name: string
  readonly description: string
  readonly payloadSchema: Readonly<Record<string, JsonValue>>
}
export interface RuntimeEventContract extends EventDeclaration {
  readonly version: 1
  readonly scope: RuntimeScope
  readonly subjects: readonly RuntimeSubjectKind[]
  readonly producers: readonly RuntimeProducerKind[]
}
export interface RuntimeContractIdentity {
  readonly scope: RuntimeScope
  readonly name: string
  readonly digest: ContractDigest
}
export interface RuntimeEventRef {
  readonly source: 'worksurface' | 'dsh'
  readonly subject: { readonly authority: AuthorityId; readonly kind: RuntimeSubjectKind; readonly id: RuntimeLocalId }
  readonly seq: number
  readonly id: string
}
export interface RuntimeEventEnvelope {
  readonly version: 1
  readonly id: string
  readonly subject: { readonly authority: AuthorityId; readonly kind: 'surface'; readonly id: RuntimeLocalId }
  readonly seq: number
  readonly type: { readonly scope: RuntimeScope; readonly name: string; readonly contract: ContractDigest }
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly causes: readonly RuntimeEventRef[]
  readonly producer: { readonly kind: RuntimeProducerKind; readonly ref: string }
  readonly operationKey: string
  readonly recordedAt: string
}
export interface RuntimeBindingContract {
  readonly scope: RuntimeScope
  readonly digest: ContractDigest
  readonly capabilities: readonly RuntimeCapability[]
}
export type RuntimeBinding = {
  readonly version: 1
  readonly authority: AuthorityId
  readonly contracts: Readonly<Record<string, RuntimeBindingContract>>
} & ({
  readonly kind: 'surface-turn'
  readonly execution: { readonly surfaceId: string; readonly sessionId: string; readonly turnId: string }
  readonly surfaces: Readonly<Record<string, never>>
} | {
  readonly kind: 'orchestrate-run'
  readonly execution: { readonly registrationId: string; readonly runId: string }
  readonly surfaces: Readonly<Record<string, string>>
})

export interface OrchestrateEventRouteSource {
  readonly file?: string
  readonly builtin?: true
  readonly consumeFrom?: readonly string[]
  readonly emitOn?: readonly string[]
  readonly surfaceOutputFrom?: readonly string[]
}
export interface OrchestrateRegistrationSource {
  readonly version: 1
  readonly registrationId: string
  readonly entrypoint: string
  readonly bindings: Readonly<Record<string, string>>
  readonly events: Readonly<Record<string, OrchestrateEventRouteSource>>
}
export interface OrchestrateResolvedRoute {
  readonly scope: RuntimeScope
  readonly digest: ContractDigest
  readonly consumeFrom?: readonly string[]
  readonly emitOn?: readonly string[]
  readonly surfaceOutputFrom?: readonly string[]
}
export interface OrchestrateHistoryBoundary { readonly surfaceEventSeq: number; readonly dshEventSeq: number }
export interface OrchestrateRegistrationRecord {
  readonly version: 1
  readonly authority: AuthorityId
  readonly registrationId: string
  readonly orchestrateRevision: Revision
  readonly entrypoint: string
  readonly surfaces: Readonly<Record<string, string>>
  readonly routes: Readonly<Record<string, OrchestrateResolvedRoute>>
  readonly historyBoundary: Readonly<Record<string, OrchestrateHistoryBoundary>>
}
export interface OrchestrateInputLedgerRecord {
  readonly version: 1
  readonly authority: AuthorityId
  readonly registrationId: string
  readonly inputSeq: number
  readonly event: RuntimeEventRef
  readonly acceptedAt: string
}
export interface OrchestrateInputRecord {
  readonly inputSeq: number
  readonly surface: string
  readonly event: { readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }
}
export interface OrchestrateRunState {
  readonly version: 1
  readonly triggerInputSeq: number
  readonly surfaces: Readonly<Record<string, string>>
  readonly contracts: Readonly<Record<string, { readonly file: string; readonly capabilities: readonly RuntimeCapability[] }>>
  readonly files: { readonly inputs: 'inputs.jsonl'; readonly result: 'result.json' }
}
export interface OrchestrateResultEvent {
  readonly surface: string
  readonly name: string
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly causes?: readonly number[]
  readonly key?: string
}
export interface OrchestrateResultAdvance {
  readonly surface: string
  readonly instruction: string
  readonly outputs: readonly string[]
  readonly causes?: readonly number[]
  readonly key?: string
}
export interface OrchestrateResult {
  readonly version: 1
  readonly causes?: readonly number[]
  readonly events: readonly OrchestrateResultEvent[]
  readonly advance: readonly OrchestrateResultAdvance[]
}
export interface OrchestrateBatchSurface {
  readonly surfaceId: string
  readonly baseRevision: Revision
  readonly candidateRevision: Revision
}
export interface OrchestrateBatchEvent {
  readonly surface: string
  readonly contract: RuntimeContractIdentity
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly causes: readonly RuntimeEventRef[]
  readonly operationKey: string
}
export interface OrchestrateBatchAdvance {
  readonly surface: string
  readonly instruction: string
  readonly outputs: readonly RuntimeContractIdentity[]
  readonly causes: readonly RuntimeEventRef[]
  readonly operationKey: string
}
export interface OrchestrateOperationBatch {
  readonly version: 1
  readonly authority: AuthorityId
  readonly registrationId: string
  readonly runId: string
  readonly orchestrateRevision: Revision
  readonly triggerInputSeq: number
  readonly causes: readonly RuntimeEventRef[]
  readonly surfaces: Readonly<Record<string, OrchestrateBatchSurface>>
  readonly events: readonly OrchestrateBatchEvent[]
  readonly advance: readonly OrchestrateBatchAdvance[]
  readonly recordedAt: string
}
export interface OrchestrateOperationSettlement {
  readonly version: 1
  readonly authority: AuthorityId
  readonly registrationId: string
  readonly runId: string
  readonly surfaceRevisions: Readonly<Record<string, Revision>>
  readonly events: readonly { readonly operationKey: string; readonly event: RuntimeEventRef }[]
  readonly advance: readonly { readonly operationKey: string; readonly surface: string; readonly sessionId: string; readonly turnId: string }[]
  readonly settledAt: string
}

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const AUTHORITY_ID = /^wsa_[a-z0-9][a-z0-9_-]{7,127}$/
const EVENT_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const FORBIDDEN_PATH = /(?:^|\/)\.\.?(?:\/|$)|\\|[?#%\u0000\r\n]/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

export function validateAuthority(value: unknown): asserts value is RuntimeAuthority {
  const record = object(value, 'Runtime authority')
  exact(record, ['version', 'id'], 'Runtime authority')
  if (record.version !== 1 || typeof record.id !== 'string' || !AUTHORITY_ID.test(record.id)) invalid('Runtime authority has an invalid shape')
}

export function createAuthority(id: string): RuntimeAuthority {
  const authority = { version: 1 as const, id: id as AuthorityId }
  validateAuthority(authority)
  return Object.freeze(authority)
}

export function canonicalEventContract(input: RuntimeEventContract): RuntimeEventContract {
  validateRuntimeEventContract(input)
  return deepFreeze({
    ...structuredClone(input),
    subjects: [...new Set(input.subjects)].sort(),
    producers: [...new Set(input.producers)].sort(),
  })
}

export function eventContractDigest(input: RuntimeEventContract): ContractDigest {
  return `sha256:${sha256(stableStringify(canonicalEventContract(input)))}`
}

export function validateRuntimeEventContract(value: unknown): asserts value is RuntimeEventContract {
  const record = object(value, 'Event Contract')
  exact(record, ['version', 'scope', 'name', 'description', 'subjects', 'producers', 'payloadSchema'], 'Event Contract')
  if (record.version !== 1) invalid('Event Contract version must be 1')
  validateScope(record.scope)
  eventName(record.name, 'Event Contract name')
  text(record.description, 'Event Contract description')
  stringSet(record.subjects, ['surface', 'dsh-session'], 'Event Contract subjects')
  stringSet(record.producers, ['surface-session', 'orchestrate', 'runtime', 'dsh-adapter'], 'Event Contract producers')
  const schema = object(record.payloadSchema, 'Event Contract payloadSchema')
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || schema.type !== 'object') invalid('Event Contract payloadSchema must be a Draft 2020-12 object schema')
}

export function validatePayload(contract: RuntimeEventContract, payload: unknown): asserts payload is Readonly<Record<string, JsonValue>> {
  validateRuntimeEventContract(contract)
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }))
  let validate: ValidateFunction
  try { validate = ajv.compile(structuredClone(contract.payloadSchema)) }
  catch (error) { throw new WorkSurfaceError('invalid-definition', `Event Contract '${contract.name}' has an invalid payload schema`, { cause: String(error) }) }
  if (!validate(payload)) throw new WorkSurfaceError('invalid-working-copy', `payload violates Event Contract '${contract.name}'`, { errors: validate.errors ?? [] })
}

export function validateRuntimeEventRef(value: unknown): asserts value is RuntimeEventRef {
  const record = object(value, 'EventRef')
  exact(record, ['source', 'subject', 'seq', 'id'], 'EventRef')
  if (!['worksurface', 'dsh'].includes(String(record.source))) invalid('EventRef source is invalid')
  const subject = object(record.subject, 'EventRef subject')
  exact(subject, ['authority', 'kind', 'id'], 'EventRef subject')
  authorityId(subject.authority, 'EventRef authority')
  localId(subject.id, 'EventRef subject id')
  if (record.source === 'worksurface' ? subject.kind !== 'surface' : subject.kind !== 'dsh-session') invalid('EventRef source and subject kind disagree')
  nonnegative(record.seq, 'EventRef seq')
  text(record.id, 'EventRef id')
}

export function validateRuntimeEventEnvelope(value: unknown): asserts value is RuntimeEventEnvelope {
  const record = object(value, 'Runtime Event')
  exact(record, ['version', 'id', 'subject', 'seq', 'type', 'payload', 'causes', 'producer', 'operationKey', 'recordedAt'], 'Runtime Event')
  if (record.version !== 1) invalid('Runtime Event version must be 1')
  text(record.id, 'Runtime Event id')
  const subject = object(record.subject, 'Runtime Event subject')
  exact(subject, ['authority', 'kind', 'id'], 'Runtime Event subject')
  authorityId(subject.authority, 'Runtime Event authority')
  if (subject.kind !== 'surface') invalid('Runtime Event subject must be a Surface')
  localId(subject.id, 'Runtime Event subject id')
  nonnegative(record.seq, 'Runtime Event seq')
  const type = object(record.type, 'Runtime Event type')
  exact(type, ['scope', 'name', 'contract'], 'Runtime Event type')
  validateScope(type.scope)
  eventName(type.name, 'Runtime Event name')
  digest(type.contract, 'Runtime Event contract')
  object(record.payload, 'Runtime Event payload')
  if (!Array.isArray(record.causes)) invalid('Runtime Event causes must be an array')
  for (const cause of record.causes) validateRuntimeEventRef(cause)
  const producer = object(record.producer, 'Runtime Event producer')
  exact(producer, ['kind', 'ref'], 'Runtime Event producer')
  if (!['surface-session', 'orchestrate', 'runtime', 'dsh-adapter'].includes(String(producer.kind))) invalid('Runtime Event producer is invalid')
  text(producer.ref, 'Runtime Event producer ref')
  text(record.operationKey, 'Runtime Event operationKey')
  dateTime(record.recordedAt, 'Runtime Event recordedAt')
  if (type.scope !== undefined && (type.scope as RuntimeScope).authority !== subject.authority) invalid('Runtime Event type and subject authorities disagree')
}

export function validateRuntimeBinding(value: unknown): asserts value is RuntimeBinding {
  const record = object(value, 'Runtime Binding')
  exact(record, ['version', 'kind', 'authority', 'execution', 'surfaces', 'contracts'], 'Runtime Binding')
  if (record.version !== 1 || !['surface-turn', 'orchestrate-run'].includes(String(record.kind))) invalid('Runtime Binding has an invalid version or kind')
  authorityId(record.authority, 'Runtime Binding authority')
  const execution = object(record.execution, 'Runtime Binding execution')
  const surfaces = object(record.surfaces, 'Runtime Binding surfaces')
  const contracts = object(record.contracts, 'Runtime Binding contracts')
  if (record.kind === 'surface-turn') {
    exact(execution, ['surfaceId', 'sessionId', 'turnId'], 'Surface Turn execution')
    localId(execution.surfaceId, 'Surface id'); localId(execution.sessionId, 'Session id'); localId(execution.turnId, 'Turn id')
    if (Object.keys(surfaces).length !== 0) invalid('Surface Turn Binding cannot expose Surface handles')
  } else {
    exact(execution, ['registrationId', 'runId'], 'Orchestrate execution')
    localId(execution.registrationId, 'Registration id'); localId(execution.runId, 'Run id')
    if (Object.keys(surfaces).length === 0) invalid('Orchestrate Binding requires Surface handles')
  }
  for (const [handle, surface] of Object.entries(surfaces)) { localId(handle, 'Surface handle'); localId(surface, `Surface '${handle}'`) }
  if (record.kind === 'orchestrate-run' && Object.keys(contracts).length === 0) invalid('Orchestrate Binding requires Event Contracts')
  for (const [name, candidate] of Object.entries(contracts)) {
    eventName(name, 'Binding Event name')
    const contract = object(candidate, `Binding Event '${name}'`)
    exact(contract, ['scope', 'digest', 'capabilities'], `Binding Event '${name}'`)
    validateScope(contract.scope)
    if ((contract.scope as RuntimeScope).authority !== record.authority) invalid(`Binding Event '${name}' belongs to another authority`)
    digest(contract.digest, `Binding Event '${name}' digest`)
    stringSet(contract.capabilities, ['consume', 'orchestrate-emit', 'surface-output'], `Binding Event '${name}' capabilities`, true)
    if (record.kind === 'surface-turn' && stableStringify(contract.capabilities) !== stableStringify(['surface-output'])) invalid(`Surface Turn Event '${name}' must grant only surface-output`)
  }
}

export function orchestrateRuntimeBinding(registration: OrchestrateRegistrationRecord, runId: string): RuntimeBinding {
  validateRegistrationRecord(registration); localId(runId, 'Run id')
  const contracts: Record<string, RuntimeBindingContract> = {}
  for (const [name, route] of Object.entries(registration.routes)) contracts[name] = {
    scope: route.scope,
    digest: route.digest,
    capabilities: [
      ...(route.consumeFrom === undefined ? [] : ['consume'] as const),
      ...(route.emitOn === undefined ? [] : ['orchestrate-emit'] as const),
      ...(route.surfaceOutputFrom === undefined ? [] : ['surface-output'] as const),
    ],
  }
  const binding: RuntimeBinding = { version: 1, kind: 'orchestrate-run', authority: registration.authority, execution: { registrationId: registration.registrationId, runId }, surfaces: registration.surfaces, contracts }
  validateRuntimeBinding(binding)
  return deepFreeze(binding)
}

export function surfaceTurnRuntimeBinding(
  authority: AuthorityId,
  execution: { readonly surfaceId: string; readonly sessionId: string; readonly turnId: string },
  contracts: Readonly<Record<string, { readonly scope: RuntimeScope; readonly digest: ContractDigest }>>,
): RuntimeBinding {
  const binding: RuntimeBinding = { version: 1, kind: 'surface-turn', authority, execution, surfaces: {}, contracts: Object.fromEntries(Object.entries(contracts).map(([name, contract]) => [name, { ...contract, capabilities: ['surface-output'] }])) }
  validateRuntimeBinding(binding)
  return deepFreeze(binding)
}

export function parseOrchestrateRegistration(value: unknown): OrchestrateRegistrationSource {
  const record = object(value, 'Orchestrate Registration')
  exact(record, ['version', 'registrationId', 'entrypoint', 'bindings', 'events'], 'Orchestrate Registration')
  if (record.version !== 1) invalid('Orchestrate Registration version must be 1')
  localId(record.registrationId, 'Registration id')
  relativePath(record.entrypoint, 'Registration entrypoint')
  const bindings = object(record.bindings, 'Registration bindings')
  if (Object.keys(bindings).length === 0) invalid('Registration must bind at least one Surface')
  const surfaceIds = new Set<string>()
  for (const [handle, surface] of Object.entries(bindings)) {
    localId(handle, 'Surface handle'); localId(surface, `Surface '${handle}'`)
    if (surfaceIds.has(surface as string)) invalid(`Surface '${surface}' is bound by multiple handles`)
    surfaceIds.add(surface as string)
  }
  const events = object(record.events, 'Registration events')
  if (Object.keys(events).length === 0) invalid('Registration must declare at least one Event route')
  for (const [name, candidate] of Object.entries(events)) {
    eventName(name, 'Event route name')
    const route = object(candidate, `Event route '${name}'`)
    exact(route, ['file', 'builtin', 'consumeFrom', 'emitOn', 'surfaceOutputFrom'], `Event route '${name}'`)
    if ((route.file === undefined) === (route.builtin === undefined)) invalid(`Event route '${name}' must select exactly one Contract source`)
    if (route.file !== undefined) relativePath(route.file, `Event route '${name}' file`)
    if (route.builtin !== undefined && route.builtin !== true) invalid(`Event route '${name}' builtin must be true`)
    let capability = false
    for (const key of ['consumeFrom', 'emitOn', 'surfaceOutputFrom'] as const) {
      if (route[key] === undefined) continue
      capability = true
      stringSet(route[key], Object.keys(bindings), `Event route '${name}' ${key}`, true)
    }
    if (!capability) invalid(`Event route '${name}' has no capability`)
  }
  return deepFreeze(structuredClone(record) as unknown as OrchestrateRegistrationSource)
}

export function validateRegistrationRecord(value: unknown): asserts value is OrchestrateRegistrationRecord {
  const record = object(value, 'Registration record')
  exact(record, ['version', 'authority', 'registrationId', 'orchestrateRevision', 'entrypoint', 'surfaces', 'routes', 'historyBoundary'], 'Registration record')
  if (record.version !== 1) invalid('Registration record version must be 1')
  authorityId(record.authority, 'Registration authority')
  localId(record.registrationId, 'Registration id')
  digest(record.orchestrateRevision, 'Orchestrate Revision')
  relativePath(record.entrypoint, 'Registration entrypoint')
  const surfaces = object(record.surfaces, 'Registration surfaces')
  const routes = object(record.routes, 'Registration routes')
  const boundaries = object(record.historyBoundary, 'Registration history boundary')
  if (Object.keys(surfaces).length === 0 || Object.keys(routes).length === 0) invalid('Registration record must contain Surfaces and routes')
  for (const [handle, surface] of Object.entries(surfaces)) { localId(handle, 'Surface handle'); localId(surface, `Surface '${handle}'`) }
  if (new Set(Object.values(surfaces)).size !== Object.keys(surfaces).length) invalid('Registration record binds one Surface through multiple handles')
  if (stableStringify(Object.keys(surfaces).sort()) !== stableStringify(Object.keys(boundaries).sort())) invalid('Registration history boundary must cover every Surface handle exactly')
  for (const [handle, candidate] of Object.entries(boundaries)) {
    const boundary = object(candidate, `History boundary '${handle}'`)
    exact(boundary, ['surfaceEventSeq', 'dshEventSeq'], `History boundary '${handle}'`)
    integerAtLeast(boundary.surfaceEventSeq, -1, 'surfaceEventSeq'); integerAtLeast(boundary.dshEventSeq, -1, 'dshEventSeq')
  }
  for (const [name, candidate] of Object.entries(routes)) {
    eventName(name, 'Resolved route name')
    const route = object(candidate, `Resolved route '${name}'`)
    exact(route, ['scope', 'digest', 'consumeFrom', 'emitOn', 'surfaceOutputFrom'], `Resolved route '${name}'`)
    validateScope(route.scope); digest(route.digest, 'Resolved route digest')
    if ((route.scope as RuntimeScope).authority !== record.authority) invalid(`Resolved route '${name}' belongs to another authority`)
    let capability = false
    for (const key of ['consumeFrom', 'emitOn', 'surfaceOutputFrom'] as const) if (route[key] !== undefined) { capability = true; stringSet(route[key], Object.keys(surfaces), `Resolved route '${name}' ${key}`, true) }
    if (!capability) invalid(`Resolved route '${name}' has no capability`)
  }
}

export function validateOrchestrateResult(value: unknown, registration: OrchestrateRegistrationRecord): asserts value is OrchestrateResult {
  const record = object(value, 'Orchestrate result')
  exact(record, ['version', 'causes', 'events', 'advance'], 'Orchestrate result')
  if (record.version !== 1 || !Array.isArray(record.events) || !Array.isArray(record.advance)) invalid('Orchestrate result has an invalid shape')
  if (record.causes !== undefined) integerSet(record.causes, 'Orchestrate result causes')
  const keys = new Set<string>()
  for (const [kind, values] of [['event', record.events], ['advance', record.advance]] as const) for (const candidate of values) {
    const item = object(candidate, `Orchestrate result ${kind}`)
    const allowed = kind === 'event' ? ['surface', 'name', 'payload', 'causes', 'key'] : ['surface', 'instruction', 'outputs', 'causes', 'key']
    exact(item, allowed, `Orchestrate result ${kind}`)
    localId(item.surface, `${kind} Surface handle`)
    if (!(item.surface as string in registration.surfaces)) invalid(`${kind} targets unknown Surface handle '${item.surface}'`)
    if (item.causes !== undefined) integerSet(item.causes, `${kind} causes`)
    if (item.key !== undefined) { text(item.key, `${kind} key`); if (keys.has(item.key as string)) invalid(`duplicate result key '${item.key}'`); keys.add(item.key as string) }
    if (kind === 'event') { eventName(item.name, 'event name'); object(item.payload, 'event payload') }
    else { text(item.instruction, 'advance instruction'); if (!Array.isArray(item.outputs)) invalid('advance outputs must be an array'); stringSet(item.outputs, Object.keys(registration.routes), 'advance outputs') }
  }
}

export function validateOperationBatch(value: unknown): asserts value is OrchestrateOperationBatch {
  const record = object(value, 'Operation batch')
  exact(record, ['version', 'authority', 'registrationId', 'runId', 'orchestrateRevision', 'triggerInputSeq', 'causes', 'surfaces', 'events', 'advance', 'recordedAt'], 'Operation batch')
  if (record.version !== 1) invalid('Operation batch version must be 1')
  authorityId(record.authority, 'Operation authority'); localId(record.registrationId, 'Registration id'); localId(record.runId, 'Run id')
  digest(record.orchestrateRevision, 'Orchestrate Revision'); nonnegative(record.triggerInputSeq, 'triggerInputSeq'); dateTime(record.recordedAt, 'recordedAt')
  if (!Array.isArray(record.causes) || record.causes.length === 0 || new Set(record.causes.map(cause => stableStringify(cause))).size !== record.causes.length) invalid('Operation batch requires unique causes')
  record.causes.forEach(validateRuntimeEventRef)
  const surfaces = object(record.surfaces, 'Operation surfaces')
  if (Object.keys(surfaces).length === 0) invalid('Operation batch requires Surface revisions')
  for (const [handle, candidate] of Object.entries(surfaces)) {
    localId(handle, 'Operation Surface handle'); const item = object(candidate, `Operation Surface '${handle}'`)
    exact(item, ['surfaceId', 'baseRevision', 'candidateRevision'], `Operation Surface '${handle}'`)
    localId(item.surfaceId, 'Operation Surface id'); digest(item.baseRevision, 'baseRevision'); digest(item.candidateRevision, 'candidateRevision')
  }
  if (!Array.isArray(record.events) || !Array.isArray(record.advance)) invalid('Operation batch effects must be arrays')
  for (const candidate of record.events) validateBatchEvent(candidate, surfaces)
  for (const candidate of record.advance) validateBatchAdvance(candidate, surfaces)
}

export function validateOperationSettlement(value: unknown): asserts value is OrchestrateOperationSettlement {
  const record = object(value, 'Operation settlement')
  exact(record, ['version', 'authority', 'registrationId', 'runId', 'surfaceRevisions', 'events', 'advance', 'settledAt'], 'Operation settlement')
  if (record.version !== 1) invalid('Operation settlement version must be 1')
  authorityId(record.authority, 'Settlement authority'); localId(record.registrationId, 'Registration id'); localId(record.runId, 'Run id'); dateTime(record.settledAt, 'settledAt')
  const revisions = object(record.surfaceRevisions, 'Settlement Surface revisions')
  if (Object.keys(revisions).length === 0) invalid('Settlement requires Surface revisions')
  for (const [handle, revision] of Object.entries(revisions)) { localId(handle, 'Settlement Surface handle'); digest(revision, 'Settlement revision') }
  if (!Array.isArray(record.events) || !Array.isArray(record.advance)) invalid('Settlement effects must be arrays')
  for (const candidate of record.events) { const item = object(candidate, 'Settlement event'); exact(item, ['operationKey', 'event'], 'Settlement event'); text(item.operationKey, 'operationKey'); validateRuntimeEventRef(item.event); if ((item.event as RuntimeEventRef).source !== 'worksurface') invalid('Settlement Event receipt must reference a WorkSurface Event') }
  for (const candidate of record.advance) { const item = object(candidate, 'Settlement advance'); exact(item, ['operationKey', 'surface', 'sessionId', 'turnId'], 'Settlement advance'); text(item.operationKey, 'operationKey'); localId(item.surface, 'advance Surface'); localId(item.sessionId, 'Session id'); localId(item.turnId, 'Turn id') }
}

export function operationKey(registrationId: string, runId: string, kind: 'event' | 'advance', index: number, supplied?: string): string {
  if (supplied !== undefined) { text(supplied, 'operation key'); return supplied }
  return `${kind}_${sha256(`${registrationId}\0${runId}\0${kind}\0${index}`).slice(0, 40)}`
}

export function runtimeEventId(authority: AuthorityId, producerRef: string, operation: string, surfaceId: string): string {
  return `evt_${sha256(`${authority}\0${producerRef}\0${operation}\0${surfaceId}`).slice(0, 40)}`
}

function validateScope(value: unknown): asserts value is RuntimeScope {
  const scope = object(value, 'Event scope'); exact(scope, ['authority', 'kind', 'id'], 'Event scope')
  authorityId(scope.authority, 'Event scope authority')
  if (!['builtin', 'registration'].includes(String(scope.kind))) invalid('Event scope kind is invalid')
  localId(scope.id, 'Event scope id')
}

function validateBatchEvent(value: unknown, surfaces: Readonly<Record<string, unknown>>): void {
  const item = object(value, 'Operation event')
  exact(item, ['surface', 'contract', 'payload', 'causes', 'operationKey'], 'Operation event')
  localId(item.surface, 'Operation event Surface'); if (!(item.surface as string in surfaces)) invalid(`Operation event targets unknown Surface '${item.surface}'`)
  validateContractIdentity(item.contract); object(item.payload, 'Operation event payload')
  if (!Array.isArray(item.causes) || item.causes.length === 0) invalid('Operation event requires causes'); item.causes.forEach(validateRuntimeEventRef)
  text(item.operationKey, 'Operation event key')
}

function validateBatchAdvance(value: unknown, surfaces: Readonly<Record<string, unknown>>): void {
  const item = object(value, 'Operation advance')
  exact(item, ['surface', 'instruction', 'outputs', 'causes', 'operationKey'], 'Operation advance')
  localId(item.surface, 'Operation advance Surface'); if (!(item.surface as string in surfaces)) invalid(`Operation advance targets unknown Surface '${item.surface}'`)
  text(item.instruction, 'Operation advance instruction')
  if (!Array.isArray(item.outputs)) invalid('Operation advance outputs must be an array'); item.outputs.forEach(validateContractIdentity)
  if (!Array.isArray(item.causes) || item.causes.length === 0) invalid('Operation advance requires causes'); item.causes.forEach(validateRuntimeEventRef)
  text(item.operationKey, 'Operation advance key')
}

function validateContractIdentity(value: unknown): void {
  const item = object(value, 'Contract identity'); exact(item, ['scope', 'name', 'digest'], 'Contract identity')
  validateScope(item.scope); eventName(item.name, 'Contract name'); digest(item.digest, 'Contract digest')
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label} has unknown field '${key}'`)
}
function text(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.length === 0) invalid(`${label} must be non-empty`) }
function localId(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !LOCAL_ID.test(value)) invalid(`${label} is invalid`) }
function authorityId(value: unknown, label: string): asserts value is AuthorityId { if (typeof value !== 'string' || !AUTHORITY_ID.test(value)) invalid(`${label} is invalid`) }
function eventName(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !EVENT_NAME.test(value)) invalid(`${label} is invalid`) }
function digest(value: unknown, label: string): asserts value is ContractDigest { if (typeof value !== 'string' || !DIGEST.test(value)) invalid(`${label} is invalid`) }
function relativePath(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || SCHEME.test(value) || FORBIDDEN_PATH.test(value)) invalid(`${label} is unsafe`) }
function nonnegative(value: unknown, label: string): asserts value is number { integerAtLeast(value, 0, label) }
function integerAtLeast(value: unknown, min: number, label: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min) invalid(`${label} must be an integer >= ${min}`) }
function dateTime(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(`${label} must be an ISO date-time`) }
function stringSet(value: unknown, allowed: readonly string[], label: string, requireNonempty = false): asserts value is readonly string[] {
  if (!Array.isArray(value) || (requireNonempty && value.length === 0) || new Set(value).size !== value.length) invalid(`${label} must be a${requireNonempty ? ' non-empty' : ''} unique array`)
  for (const item of value) if (typeof item !== 'string' || !allowed.includes(item)) invalid(`${label} contains invalid value '${String(item)}'`)
}
function integerSet(value: unknown, label: string): asserts value is readonly number[] { if (!Array.isArray(value) || new Set(value).size !== value.length) invalid(`${label} must be a unique integer array`); value.forEach(item => nonnegative(item, label)) }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child) } return value }
function invalid(message: string): never { throw new WorkSurfaceError('invalid-working-copy', message) }
