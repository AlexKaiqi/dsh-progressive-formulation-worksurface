import { lstat, readFile } from 'node:fs/promises'
import {
  EventContractStore,
  externalHistoryBoundarySeq,
  InputLedgerStore,
  OperationLedgerStore,
  RegistrationRecordStore,
  RevisionStore,
  RuntimeEventStore,
  WorkSurfaceError,
  canonicalEventContract,
  operationKey,
  parseOrchestrateRegistration,
  runtimeEventId,
  stableStringify,
  validatePayload,
  type AuthorityId,
  type EventDeclaration,
  type JsonValue,
  type OrchestrateBatchAdvance,
  type OrchestrateBatchEvent,
  type OrchestrateHistoryBoundary,
  type OrchestrateInputRecord,
  type OrchestrateOperationBatch,
  type OrchestrateOperationSettlement,
  type OrchestrateRegistrationRecord,
  type OrchestrateRegistrationSource,
  type Revision,
  type RuntimeContractIdentity,
  type RuntimeEventContract,
  type RuntimeEventEnvelope,
  type RuntimeEventRef,
} from '@pf-worksurface/core'
import type { OrchestrateCodeRunner } from './orchestrate-contract.ts'

export interface BuiltinEventSource {
  readonly description: string
  readonly exposure: 'runtime-only' | 'orchestrate-input'
  readonly subjects: RuntimeEventContract['subjects']
  readonly producers: RuntimeEventContract['producers']
  readonly payloadSchema: RuntimeEventContract['payloadSchema']
}
export interface CodeFirstRegistrationInspection {
  readonly registrationId: string
  readonly orchestrateRevision: Revision
  readonly bindings: Readonly<Record<string, string>>
  readonly routes: OrchestrateRegistrationRecord['routes']
  readonly acceptedInputCount: number
  readonly recordedRunCount: number
  readonly pendingRunCount: number
}
export interface CodeFirstSurfacePort {
  head(surfaceId: string): Promise<Revision>
  historyBoundary(surfaceId: string): Promise<OrchestrateHistoryBoundary>
  resolveExternalInput(event: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }>
  apply(
    surfaceId: string,
    baseRevision: Revision,
    candidateRevision: Revision,
    evidence: { readonly registrationId: string; readonly runId: string; readonly causes: readonly RuntimeEventRef[] },
  ): Promise<Revision>
  advance(
    surfaceId: string,
    instruction: string,
    outputs: readonly RuntimeContractIdentity[],
    causes: readonly RuntimeEventRef[],
    operationKey: string,
  ): Promise<{ readonly executionId: string; readonly turnId: string }>
}

/** Target code-first registration, input, run, record/apply/settle runtime. */
export class CodeFirstOrchestrator {
  private mutation: Promise<void> = Promise.resolve()
  constructor(
    readonly authority: AuthorityId,
    private readonly revisions: RevisionStore,
    private readonly contracts: EventContractStore,
    private readonly events: RuntimeEventStore,
    private readonly registrations: RegistrationRecordStore,
    private readonly inputs: InputLedgerStore,
    private readonly operations: OperationLedgerStore,
    private readonly runner: OrchestrateCodeRunner,
    private readonly surfaces: CodeFirstSurfacePort,
    private readonly builtins: Readonly<Record<string, BuiltinEventSource>>,
  ) {}

  async init(): Promise<void> {
    await Promise.all([this.contracts.init(), this.events.init(), this.registrations.init(), this.inputs.init(), this.operations.init()])
    await this.recover()
  }

  /** registration.json is outside artifactRoot; mutable authoring files are never read after admission. */
  async admit(registrationFile: string, artifactRoot: string): Promise<OrchestrateRegistrationRecord> {
    const info = await lstat(registrationFile)
    if (!info.isFile() || info.isSymbolicLink()) throw new WorkSurfaceError('invalid-definition', 'registration.json must be a regular file')
    let source: OrchestrateRegistrationSource
    try { source = parseOrchestrateRegistration(JSON.parse(await readFile(registrationFile, 'utf8'))) }
    catch (error) { if (error instanceof SyntaxError) throw new WorkSurfaceError('invalid-definition', 'registration.json is invalid JSON'); throw error }
    const snapshot = await this.revisions.snapshot(artifactRoot, 'artifact')
    if (!snapshot.manifest.entries.some(entry => entry.path === source.entrypoint)) throw new WorkSurfaceError('invalid-definition', `entrypoint '${source.entrypoint}' is absent from the Orchestrate artifact`)

    const routes: OrchestrateRegistrationRecord['routes'] extends Readonly<infer T> ? T : never = {}
    for (const [name, route] of Object.entries(source.events).sort(([a], [b]) => a.localeCompare(b))) {
      let contract: RuntimeEventContract
      if (route.builtin === true) {
        const builtin = this.builtins[name]
        if (builtin === undefined) throw new WorkSurfaceError('invalid-definition', `unknown built-in Event '${name}'`)
        if (route.consumeFrom !== undefined && builtin.exposure !== 'orchestrate-input') throw new WorkSurfaceError('unauthorized', `built-in Event '${name}' is runtime-only`)
        contract = canonicalEventContract({ version: 1, scope: { authority: this.authority, kind: 'builtin', id: 'worksurface' }, name, description: builtin.description, subjects: builtin.subjects, producers: builtin.producers, payloadSchema: builtin.payloadSchema })
      } else {
        const path = route.file!
        let declaration: EventDeclaration
        try { declaration = JSON.parse((await this.revisions.readFile(snapshot.revision, path)).toString('utf8')) as EventDeclaration }
        catch (error) { if (error instanceof SyntaxError) throw new WorkSurfaceError('invalid-definition', `Event declaration '${path}' is invalid JSON`); throw error }
        validateDeclaration(declaration, name)
        const producers = [
          ...(route.emitOn === undefined ? [] : ['orchestrate'] as const),
          ...(route.surfaceOutputFrom === undefined ? [] : ['surface-session'] as const),
        ]
        if (producers.length === 0) throw new WorkSurfaceError('invalid-definition', `Registration-local Event '${name}' has no producer capability`)
        contract = canonicalEventContract({ version: 1, scope: { authority: this.authority, kind: 'registration', id: source.registrationId }, ...declaration, subjects: ['surface'], producers })
      }
      const digest = await this.contracts.put(contract)
      routes[name] = {
        scope: contract.scope,
        digest,
        ...(route.consumeFrom === undefined ? {} : { consumeFrom: [...route.consumeFrom].sort() }),
        ...(route.emitOn === undefined ? {} : { emitOn: [...route.emitOn].sort() }),
        ...(route.surfaceOutputFrom === undefined ? {} : { surfaceOutputFrom: [...route.surfaceOutputFrom].sort() }),
      }
    }
    try {
      const existing = await this.registrations.get(source.registrationId)
      const fixed = {
        authority: existing.authority,
        orchestrateRevision: existing.orchestrateRevision,
        entrypoint: existing.entrypoint,
        surfaces: existing.surfaces,
        routes: existing.routes,
      }
      const candidate = {
        authority: this.authority,
        orchestrateRevision: snapshot.revision,
        entrypoint: source.entrypoint,
        surfaces: sortRecord(source.bindings),
        routes: sortRecord(routes),
      }
      if (stableStringify(fixed) !== stableStringify(candidate)) throw new WorkSurfaceError('already-exists-conflict', `Registration '${source.registrationId}' authoring no longer matches its admitted immutable facts`)
      return existing
    } catch (error) {
      if (!(error instanceof WorkSurfaceError) || error.code !== 'not-found') throw error
    }
    const historyBoundary: Record<string, OrchestrateHistoryBoundary> = {}
    for (const [handle, surfaceId] of Object.entries(source.bindings).sort(([a], [b]) => a.localeCompare(b))) historyBoundary[handle] = await this.surfaces.historyBoundary(surfaceId)
    const record: OrchestrateRegistrationRecord = {
      version: 1,
      authority: this.authority,
      registrationId: source.registrationId,
      orchestrateRevision: snapshot.revision,
      entrypoint: source.entrypoint,
      surfaces: sortRecord(source.bindings),
      routes: sortRecord(routes),
      historyBoundary,
    }
    await this.registrations.put(record)
    return record
  }

  /** Wakeups are advisory; every pass replays durable Registration and Event facts. */
  accept(event: RuntimeEventEnvelope): Promise<void> {
    return this.serialize(() => this.acceptSurfaceLocked(event))
  }

  /** Accept a host-session fact without copying its payload into the runtime log. */
  acceptExternal(event: RuntimeEventRef, surfaceId: string, name: string): Promise<void> {
    return this.serialize(async () => {
      if (event.source === 'worksurface' || event.subject.authority !== this.authority) throw new WorkSurfaceError('invalid-working-copy', 'host adapter produced an invalid EventRef')
      for (const registrationId of await this.registrations.list()) {
        const registration = await this.registrations.get(registrationId)
        const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
        if (handle === undefined) continue
        const route = registration.routes[name]
        if (route === undefined || !route.consumeFrom?.includes(handle)) continue
        const contract = await this.contracts.get(route.digest)
        if (contract.name !== name || contract.scope.kind !== 'builtin') throw new WorkSurfaceError('canonical-corrupt', `External route '${name}' does not resolve its built-in Contract`)
        if (event.seq <= externalHistoryBoundarySeq(registration.historyBoundary[handle]!)) continue
        const existing = await this.inputs.replay(registrationId)
        if (existing.some(record => stableStringify(record.event) === stableStringify(event))) continue
        const accepted = await this.inputs.append(registrationId, event)
        await this.run(registration, accepted.inputSeq)
      }
    })
  }

  async recover(): Promise<void> {
    await this.serialize(async () => {
      for (const batch of await this.operations.pending()) await this.apply(batch)
      for (const surfaceId of await this.events.listSurfaces()) {
        for (const event of await this.events.replay(surfaceId)) await this.acceptSurfaceLocked(event)
      }
      const recorded = await this.operations.recorded()
      for (const registrationId of await this.registrations.list()) {
        const registration = await this.registrations.get(registrationId)
        const completed = new Set(recorded.filter(batch => batch.registrationId === registrationId).map(batch => batch.triggerInputSeq))
        for (const input of await this.inputs.replay(registrationId)) if (!completed.has(input.inputSeq)) await this.run(registration, input.inputSeq)
      }
    })
  }

  private async acceptSurfaceLocked(event: RuntimeEventEnvelope): Promise<void> {
    for (const registrationId of await this.registrations.list()) {
      const registration = await this.registrations.get(registrationId)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === event.subject.id)?.[0]
      if (handle === undefined) continue
      const route = registration.routes[event.type.name]
      if (route === undefined || route.digest !== event.type.contract || stableStringify(route.scope) !== stableStringify(event.type.scope) || !route.consumeFrom?.includes(handle)) continue
      if (event.seq <= registration.historyBoundary[handle]!.surfaceEventSeq) continue
      const ref = toRef(event)
      const existing = await this.inputs.replay(registrationId)
      if (existing.some(record => stableStringify(record.event) === stableStringify(ref))) continue
      const accepted = await this.inputs.append(registrationId, ref)
      await this.run(registration, accepted.inputSeq)
    }
  }

  async surfaceOutput(surfaceId: string, name: string): Promise<{ readonly registration: OrchestrateRegistrationRecord; readonly contract: RuntimeEventContract } | undefined> {
    const matches: { registration: OrchestrateRegistrationRecord; contract: RuntimeEventContract }[] = []
    for (const id of await this.registrations.list()) {
      const registration = await this.registrations.get(id)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
      const route = registration.routes[name]
      if (handle !== undefined && route?.surfaceOutputFrom?.includes(handle)) matches.push({ registration, contract: await this.contracts.get(route.digest) })
    }
    if (matches.length > 1) throw new WorkSurfaceError('already-exists-conflict', `Event '${name}' is ambiguous for Surface '${surfaceId}' across active Registrations`)
    return matches[0]
  }

  async surfaceOutputs(surfaceId: string): Promise<readonly RuntimeEventContract[]> {
    const byName = new Map<string, RuntimeEventContract>()
    for (const id of await this.registrations.list()) {
      const registration = await this.registrations.get(id)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
      if (handle === undefined) continue
      for (const [name, route] of Object.entries(registration.routes)) {
        if (!route.surfaceOutputFrom?.includes(handle)) continue
        const contract = await this.contracts.get(route.digest)
        const previous = byName.get(name)
        if (previous !== undefined && stableStringify(previous) !== stableStringify(contract)) throw new WorkSurfaceError('already-exists-conflict', `Event '${name}' is ambiguous for Surface '${surfaceId}' across active Registrations`)
        byName.set(name, contract)
      }
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  async inspectRegistrations(): Promise<readonly CodeFirstRegistrationInspection[]> {
    const recorded = await this.operations.recorded()
    const pending = await this.operations.pending()
    return Promise.all((await this.registrations.list()).map(async registrationId => {
      const registration = await this.registrations.get(registrationId)
      return {
        registrationId,
        orchestrateRevision: registration.orchestrateRevision,
        bindings: registration.surfaces,
        routes: registration.routes,
        acceptedInputCount: (await this.inputs.replay(registrationId)).length,
        recordedRunCount: recorded.filter(batch => batch.registrationId === registrationId).length,
        pendingRunCount: pending.filter(batch => batch.registrationId === registrationId).length,
      }
    }))
  }

  private async run(registration: OrchestrateRegistrationRecord, triggerInputSeq: number): Promise<void> {
    const ledger = await this.inputs.replay(registration.registrationId)
    const materialized: OrchestrateInputRecord[] = []
    const refs = new Map<number, RuntimeEventRef>()
    for (const record of ledger.filter(record => record.inputSeq <= triggerInputSeq)) {
      const resolved = record.event.source === 'worksurface'
        ? await this.resolveSurfaceInput(record.event)
        : await this.surfaces.resolveExternalInput(record.event)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === resolved.surfaceId)?.[0]
      if (handle === undefined) throw new WorkSurfaceError('canonical-corrupt', `input Event '${record.event.id}' belongs to an unbound Surface`)
      materialized.push({ inputSeq: record.inputSeq, surface: handle, event: { name: resolved.name, payload: resolved.payload } })
      refs.set(record.inputSeq, record.event)
    }
    const baseRevisions: Record<string, Revision> = {}
    for (const [handle, surfaceId] of Object.entries(registration.surfaces).sort(([a], [b]) => a.localeCompare(b))) baseRevisions[handle] = await this.surfaces.head(surfaceId)
    const contractMap: Record<string, RuntimeEventContract> = {}
    for (const [name, route] of Object.entries(registration.routes)) contractMap[name] = await this.contracts.get(route.digest)
    const output = await this.runner.run({ registration, triggerInputSeq, inputs: materialized, baseRevisions, contracts: contractMap })
    const defaultCauses = [refs.get(triggerInputSeq)!]
    const resolveCauses = (indices: readonly number[] | undefined): RuntimeEventRef[] => (indices ?? [triggerInputSeq]).map(index => {
      const ref = refs.get(index); if (ref === undefined) throw new WorkSurfaceError('invalid-working-copy', `result cause inputSeq ${index} is not in this run view`); return ref
    })
    const effectsEvents: OrchestrateBatchEvent[] = output.result.events.map((event, index) => {
      const route = registration.routes[event.name]
      if (route === undefined || !route.emitOn?.includes(event.surface)) throw new WorkSurfaceError('unauthorized', `Event '${event.name}' cannot be emitted on '${event.surface}'`)
      const contract = contractMap[event.name]!
      validatePayload(contract, event.payload)
      return { surface: event.surface, contract: { scope: route.scope, name: event.name, digest: route.digest }, payload: event.payload, causes: resolveCauses(event.causes ?? output.result.causes), operationKey: operationKey(registration.registrationId, output.runId, 'event', index, event.key) }
    })
    const effectsAdvance: OrchestrateBatchAdvance[] = output.result.advance.map((advance, index) => ({
      surface: advance.surface,
      instruction: advance.instruction,
      outputs: advance.outputs.map(name => {
        const route = registration.routes[name]
        if (route === undefined || !route.surfaceOutputFrom?.includes(advance.surface)) throw new WorkSurfaceError('unauthorized', `Surface '${advance.surface}' cannot produce '${name}'`)
        return { scope: route.scope, name, digest: route.digest }
      }),
      causes: resolveCauses(advance.causes ?? output.result.causes),
      operationKey: operationKey(registration.registrationId, output.runId, 'advance', index, advance.key),
    }))
    const batch: OrchestrateOperationBatch = {
      version: 1, authority: this.authority, registrationId: registration.registrationId, runId: output.runId,
      orchestrateRevision: registration.orchestrateRevision, triggerInputSeq, causes: defaultCauses,
      surfaces: Object.fromEntries(Object.entries(registration.surfaces).map(([handle, surfaceId]) => [handle, { surfaceId, baseRevision: baseRevisions[handle]!, candidateRevision: output.candidates[handle]! }])),
      events: effectsEvents, advance: effectsAdvance, recordedAt: new Date().toISOString(),
    }
    await this.assertUnreserved(batch)
    await this.operations.record(batch)
    await this.apply(batch)
  }

  private async resolveSurfaceInput(ref: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }> {
    const event = (await this.events.replay(ref.subject.id, ref.seq))[0]
    if (event === undefined || event.id !== ref.id) throw new WorkSurfaceError('canonical-corrupt', `Input Ledger EventRef '${ref.id}' cannot be resolved`)
    return { surfaceId: event.subject.id, name: event.type.name, payload: event.payload }
  }

  private async apply(batch: OrchestrateOperationBatch): Promise<void> {
    const surfaceRevisions: Record<string, Revision> = {}
    for (const [handle, surface] of Object.entries(batch.surfaces).sort(([a], [b]) => a.localeCompare(b))) {
      surfaceRevisions[handle] = await this.surfaces.apply(
        surface.surfaceId,
        surface.baseRevision,
        surface.candidateRevision,
        { registrationId: batch.registrationId, runId: batch.runId, causes: batch.causes },
      )
    }
    const eventReceipts: OrchestrateOperationSettlement['events'][number][] = []
    for (const effect of batch.events) {
      const surfaceId = batch.surfaces[effect.surface]!.surfaceId
      const ref = await this.events.append(surfaceId, { id: runtimeEventId(this.authority, `${batch.registrationId}/${batch.runId}`, effect.operationKey, surfaceId), type: { scope: effect.contract.scope, name: effect.contract.name, contract: effect.contract.digest }, payload: effect.payload, causes: effect.causes, producer: { kind: 'orchestrate', ref: `${batch.registrationId}/${batch.runId}` }, operationKey: effect.operationKey })
      eventReceipts.push({ operationKey: effect.operationKey, event: ref })
    }
    const advanceReceipts: OrchestrateOperationSettlement['advance'][number][] = []
    for (const effect of batch.advance) {
      const receipt = await this.surfaces.advance(batch.surfaces[effect.surface]!.surfaceId, effect.instruction, effect.outputs, effect.causes, effect.operationKey)
      advanceReceipts.push({ operationKey: effect.operationKey, surface: effect.surface, ...receipt })
    }
    const settlement: OrchestrateOperationSettlement = { version: 1, authority: this.authority, registrationId: batch.registrationId, runId: batch.runId, surfaceRevisions, events: eventReceipts, advance: advanceReceipts, settledAt: new Date().toISOString() }
    await this.operations.settle(settlement)
  }

  private async assertUnreserved(batch: OrchestrateOperationBatch): Promise<void> {
    for (const pending of await this.operations.pending()) for (const candidate of Object.values(batch.surfaces)) for (const reserved of Object.values(pending.surfaces)) {
      if (candidate.surfaceId === reserved.surfaceId && candidate.baseRevision === reserved.baseRevision) throw new WorkSurfaceError('already-exists-conflict', `Surface '${candidate.surfaceId}' base Revision is reserved by run '${pending.runId}'`)
    }
  }
  private serialize(operation: () => Promise<void>): Promise<void> { const result = this.mutation.then(operation); this.mutation = result.then(() => undefined, () => undefined); return result }
}

function validateDeclaration(value: EventDeclaration, expectedName: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new WorkSurfaceError('invalid-definition', `Event declaration '${expectedName}' must be an object`)
  if (stableStringify(Object.keys(value).sort()) !== stableStringify(['description', 'name', 'payloadSchema'])) throw new WorkSurfaceError('invalid-definition', `Event declaration '${expectedName}' has an invalid shape`)
  if (value.name !== expectedName || typeof value.description !== 'string' || value.description.length === 0 || value.payloadSchema?.$schema !== 'https://json-schema.org/draft/2020-12/schema' || value.payloadSchema.type !== 'object') throw new WorkSurfaceError('invalid-definition', `Event declaration '${expectedName}' is invalid`)
}
function toRef(event: RuntimeEventEnvelope): RuntimeEventRef { return { source: 'worksurface', subject: event.subject, seq: event.seq, id: event.id } }
function sortRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> { return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) }
