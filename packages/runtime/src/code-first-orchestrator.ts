import { lstat, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  EventContractStore,
  externalHistoryBoundarySeq,
  InputLedgerStore,
  OperationLedgerStore,
  RegistrationRecordStore,
  RegistrationStatusStore,
  RevisionStore,
  RuntimeEventStore,
  WorkSurfaceError,
  asWorkSurfaceError,
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
  type OrchestrateFailureRecord,
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
  readonly status: 'active' | 'retired'
  readonly acceptedInputCount: number
  readonly recordedRunCount: number
  readonly pendingRunCount: number
  readonly unfinishedInputCount: number
  readonly failureCount: number
  readonly lastFailure?: OrchestrateFailureRecord
}
export interface CodeFirstSurfacePort {
  head(surfaceId: string): Promise<Revision>
  historyBoundary(surfaceId: string): Promise<OrchestrateHistoryBoundary>
  resolveExternalInput(event: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }>
  /** Recheck content and record reservations atomically with respect to managed publications. */
  recordBatch(batch: OrchestrateOperationBatch, record: () => Promise<void>): Promise<void>
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

export interface CodeFirstRecoveryReport {
  readonly failedRegistrations: readonly { readonly registrationId: string; readonly code: string; readonly message: string }[]
}

/** Target code-first registration, input, run, record/apply/settle runtime. */
export class CodeFirstOrchestrator {
  private readonly mutations = new Map<string, Promise<void>>()
  private readonly retiredIds = new Set<string>()
  constructor(
    readonly authority: AuthorityId,
    private readonly revisions: RevisionStore,
    private readonly contracts: EventContractStore,
    private readonly events: RuntimeEventStore,
    private readonly registrations: RegistrationRecordStore,
    private readonly statuses: RegistrationStatusStore,
    private readonly inputs: InputLedgerStore,
    private readonly operations: OperationLedgerStore,
    private readonly runner: OrchestrateCodeRunner,
    private readonly surfaces: CodeFirstSurfacePort,
    private readonly builtins: Readonly<Record<string, BuiltinEventSource>>,
  ) {}

  async init(options: { readonly recover?: boolean } = {}): Promise<void> {
    await Promise.all([this.contracts.init(), this.events.init(), this.registrations.init(), this.statuses.init(), this.inputs.init(), this.operations.init()])
    this.retiredIds.clear()
    for (const id of await this.statuses.retired()) this.retiredIds.add(id)
    if (options.recover !== false) await this.recover()
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
        if (route.emitOn !== undefined && !builtin.producers.includes('orchestrate')) throw new WorkSurfaceError('unauthorized', `Orchestrate cannot produce built-in Event '${name}'`)
        if (route.surfaceOutputFrom !== undefined && !builtin.producers.includes('surface-session')) throw new WorkSurfaceError('unauthorized', `Surface cannot produce built-in Event '${name}'`)
        if ((route.emitOn !== undefined || route.surfaceOutputFrom !== undefined) && !builtin.subjects.includes('surface')) throw new WorkSurfaceError('unauthorized', `built-in Event '${name}' does not permit a Surface subject`)
        contract = canonicalEventContract({ version: 1, scope: { authority: this.authority, kind: 'builtin', id: 'worksurface' }, name, description: builtin.description, subjects: builtin.subjects, producers: builtin.producers, payloadSchema: builtin.payloadSchema })
      } else {
        const path = route.file!
        let declaration: EventDeclaration
        try { declaration = JSON.parse((await this.revisions.readFile(snapshot.revision, path)).toString('utf8')) as EventDeclaration }
        catch (error) { if (error instanceof SyntaxError) throw new WorkSurfaceError('invalid-definition', `Event declaration '${path}' is invalid JSON`); throw error }
        validateDeclaration(declaration, name, path)
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
      await this.revisions.pin(existing.orchestrateRevision)
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
    await this.revisions.pin(record.orchestrateRevision)
    await this.registrations.put(record)
    return record
  }

  /** Retire a Registration so it stops consuming inputs and producing outputs. */
  async retire(registrationId: string): Promise<void> {
    await this.registrations.get(registrationId)
    await this.statuses.retire(registrationId)
    this.retiredIds.add(registrationId)
  }

  /** Wakeups are advisory. Durable acceptance never implies successful execution. */
  async accept(event: RuntimeEventEnvelope): Promise<void> {
    // Resolve the durable fact rather than trusting an arbitrary envelope supplied by a caller.
    const stored = (await this.events.replay(event.subject.id, event.seq))[0]
    if (stored === undefined || stableStringify(stored) !== stableStringify(event)) throw new WorkSurfaceError('invalid-working-copy', 'Event wakeup does not match the durable Surface Event')
    await this.dispatch(async registration => {
      const ref = this.matchSurfaceInput(registration, stored)
      if (ref !== undefined) { await this.inputs.append(registration.registrationId, ref); await this.drain(registration) }
    }, true, registration => this.matchSurfaceInput(registration, stored) !== undefined)
  }

  /** The host adapter resolves external facts; delivery hints cannot forge their identity. */
  async acceptExternal(event: RuntimeEventRef, surfaceId: string, name: string): Promise<void> {
    if (event.source === 'worksurface' || event.subject.authority !== this.authority) throw new WorkSurfaceError('invalid-working-copy', 'host adapter produced an invalid EventRef')
    const resolved = await this.surfaces.resolveExternalInput(event)
    if (resolved.surfaceId !== surfaceId || resolved.name !== name) throw new WorkSurfaceError('invalid-working-copy', 'external Event hints do not match the resolved fact')
    await this.dispatch(async registration => {
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
      if (handle === undefined) return
      const route = registration.routes[name]
      if (route === undefined || !route.consumeFrom?.includes(handle)) return
      const contract = await this.contracts.get(route.digest)
      if (contract.name !== name || contract.scope.kind !== 'builtin' || this.builtins[name]?.exposure !== 'orchestrate-input') throw new WorkSurfaceError('unauthorized', `External route '${name}' is not an exposed built-in Contract`)
      validatePayload(contract, resolved.payload)
      if (event.seq <= externalHistoryBoundarySeq(registration.historyBoundary[handle]!)) return
      await this.inputs.append(registration.registrationId, event)
      await this.drain(registration)
    }, true, registration => Object.entries(registration.surfaces).some(([handle, bound]) => bound === surfaceId && registration.routes[name]?.consumeFrom?.includes(handle)))
  }

  /** Retry incomplete work once per pass. Hosts choose scheduling and retry cadence. */
  async recover(): Promise<CodeFirstRecoveryReport> {
    return this.dispatch(async registration => {
      for (const surfaceId of Object.values(registration.surfaces)) for (const event of await this.events.replay(surfaceId)) {
        const ref = this.matchSurfaceInput(registration, event)
        if (ref !== undefined) await this.inputs.append(registration.registrationId, ref)
      }
      await this.drain(registration)
    }, false)
  }

  private matchSurfaceInput(registration: OrchestrateRegistrationRecord, event: RuntimeEventEnvelope): RuntimeEventRef | undefined {
    const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === event.subject.id)?.[0]
    if (event.subject.authority !== this.authority || handle === undefined) return undefined
    const route = registration.routes[event.type.name]
    if (route === undefined || route.digest !== event.type.contract || stableStringify(route.scope) !== stableStringify(event.type.scope) || !route.consumeFrom?.includes(handle)) return undefined
    if (event.seq <= registration.historyBoundary[handle]!.surfaceEventSeq) return undefined
    return toRef(event)
  }

  private async dispatch(operation: (registration: OrchestrateRegistrationRecord) => Promise<void>, throwFailures = true, select: (registration: OrchestrateRegistrationRecord) => boolean = () => true): Promise<CodeFirstRecoveryReport> {
    const registrations = (await Promise.all((await this.registrations.list()).map(id => this.registrations.get(id))))
      .filter(registration => this.retiredIds.has(registration.registrationId) === false)
      .filter(select)
    const ids = registrations.map(registration => registration.registrationId)
    const results = await Promise.allSettled(registrations.map(registration => this.serialize(registration.registrationId, () => this.operations.withRegistrationLock(registration.registrationId, async () => operation(registration)))))
    const failedRegistrations: { registrationId: string; code: string; message: string }[] = []
    for (const [index, result] of results.entries()) if (result.status === 'rejected') {
      const error = asWorkSurfaceError(result.reason)
      // Storage corruption remains fatal after independent registrations have had a chance to recover.
      if (error.code === 'canonical-corrupt') throw error
      failedRegistrations.push({ registrationId: ids[index]!, code: error.code, message: error.message })
    }
    if (throwFailures && failedRegistrations.length > 0) throw new WorkSurfaceError('effect-failed', 'One or more Registrations remain incomplete; retry delivery or recovery', { failures: failedRegistrations })
    return { failedRegistrations }
  }

  private async drain(registration: OrchestrateRegistrationRecord): Promise<void> {
    const batches = (await this.operations.recorded()).filter(batch => batch.registrationId === registration.registrationId)
    const pending = new Set((await this.operations.pending()).map(batch => batch.runId))
    const ledger = await this.inputs.replay(registration.registrationId)
    if (batches.some(batch => !ledger.some(input => input.inputSeq === batch.triggerInputSeq))) throw new WorkSurfaceError('canonical-corrupt', `Registration '${registration.registrationId}' has an Operation batch without its accepted input`)
    for (const input of ledger) {
      const batch = batches.find(batch => batch.triggerInputSeq === input.inputSeq)
      if (batch !== undefined && !pending.has(batch.runId)) continue
      try {
        if (batch === undefined) await this.run(registration, input.inputSeq)
        else await this.apply(batch)
      } catch (cause) {
        const error = asWorkSurfaceError(cause)
        const recorded = batch ?? (await this.operations.recorded()).find(item => item.registrationId === registration.registrationId && item.triggerInputSeq === input.inputSeq)
        if (recorded !== undefined) {
          // Apply-phase failure settles the recorded run as failed so it stops
          // pending forever and is never blindly retried on the next wakeup.
          await this.operations.settleFailed(recorded.runId, { code: error.code, message: error.message, failedAt: new Date().toISOString() })
        }
        await this.operations.fail({ version: 1, authority: this.authority, attemptId: `attempt_${randomUUID()}`, registrationId: registration.registrationId, triggerInputSeq: input.inputSeq, phase: recorded === undefined ? 'run' : 'apply', ...(recorded === undefined ? {} : { runId: recorded.runId }), code: error.code, message: error.message, failedAt: new Date().toISOString() })
        throw error
      }
    }
  }

  async surfaceOutput(surfaceId: string, name: string): Promise<{ readonly registration: OrchestrateRegistrationRecord; readonly contract: RuntimeEventContract } | undefined> {
    const matches: { registration: OrchestrateRegistrationRecord; contract: RuntimeEventContract }[] = []
    for (const id of await this.registrations.list()) {
      if (this.retiredIds.has(id)) continue
      const registration = await this.registrations.get(id)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
      const route = registration.routes[name]
      if (handle !== undefined && route?.surfaceOutputFrom?.includes(handle)) {
        const contract = await this.contracts.get(route.digest)
        this.assertSurfaceOutput(contract, route, name)
        matches.push({ registration, contract })
      }
    }
    if (matches.length > 1) throw new WorkSurfaceError('already-exists-conflict', `Event '${name}' is ambiguous for Surface '${surfaceId}' across active Registrations`)
    return matches[0]
  }

  async surfaceOutputs(surfaceId: string): Promise<readonly RuntimeEventContract[]> {
    const byName = new Map<string, RuntimeEventContract>()
    for (const id of await this.registrations.list()) {
      if (this.retiredIds.has(id)) continue
      const registration = await this.registrations.get(id)
      const handle = Object.entries(registration.surfaces).find(([, surface]) => surface === surfaceId)?.[0]
      if (handle === undefined) continue
      for (const [name, route] of Object.entries(registration.routes)) {
        if (!route.surfaceOutputFrom?.includes(handle)) continue
        const contract = await this.contracts.get(route.digest)
        this.assertSurfaceOutput(contract, route, name)
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
      const failures = await this.operations.failures(registrationId)
      const ledger = await this.inputs.replay(registrationId)
      const settledInputs = new Set(recorded.filter(batch => batch.registrationId === registrationId && !pending.some(item => item.runId === batch.runId)).map(batch => batch.triggerInputSeq))
      return {
        registrationId,
        orchestrateRevision: registration.orchestrateRevision,
        bindings: registration.surfaces,
        routes: registration.routes,
        status: this.retiredIds.has(registrationId) ? 'retired' : 'active',
        acceptedInputCount: ledger.length,
        unfinishedInputCount: ledger.filter(input => !settledInputs.has(input.inputSeq)).length,
        failureCount: failures.length,
        ...(failures.at(-1) === undefined ? {} : { lastFailure: failures.at(-1)! }),
        recordedRunCount: recorded.filter(batch => batch.registrationId === registrationId).length,
        pendingRunCount: pending.filter(batch => batch.registrationId === registrationId).length,
      }
    }))
  }

  /** Durable facts, including older unpinned records, are authoritative GC roots. */
  async revisionRoots(): Promise<readonly Revision[]> {
    const [registrations, batches] = await Promise.all([
      Promise.all((await this.registrations.list()).map(id => this.registrations.get(id))),
      this.operations.recorded(),
    ])
    return [...new Set([
      ...registrations.map(registration => registration.orchestrateRevision),
      ...batches.flatMap(batch => [batch.orchestrateRevision, ...Object.values(batch.surfaces).flatMap(surface => [surface.baseRevision, surface.candidateRevision])]),
    ])].sort()
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
    await this.authorizeBatch(batch)
    await this.surfaces.recordBatch(batch, async () => {
      // Retention precedes publishing the durable batch, including when apply
      // is interrupted for longer than the collector's ordinary age grace.
      for (const revision of new Set([batch.orchestrateRevision, ...Object.values(batch.surfaces).flatMap(surface => [surface.baseRevision, surface.candidateRevision])])) await this.revisions.pin(revision)
      await this.operations.record(batch)
    })
    await this.apply(batch)
  }

  private async resolveSurfaceInput(ref: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }> {
    const event = (await this.events.replay(ref.subject.id, ref.seq))[0]
    if (event === undefined || event.id !== ref.id) throw new WorkSurfaceError('canonical-corrupt', `Input Ledger EventRef '${ref.id}' cannot be resolved`)
    return { surfaceId: event.subject.id, name: event.type.name, payload: event.payload }
  }

  private async apply(batch: OrchestrateOperationBatch): Promise<void> {
    await this.authorizeBatch(batch)
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

  /** Persisted effects are reauthorized before any content or external execution mutation. */
  private async authorizeBatch(batch: OrchestrateOperationBatch): Promise<void> {
    const registration = await this.registrations.get(batch.registrationId)
    if (batch.authority !== this.authority || batch.orchestrateRevision !== registration.orchestrateRevision || stableStringify(Object.fromEntries(Object.entries(batch.surfaces).map(([handle, surface]) => [handle, surface.surfaceId]))) !== stableStringify(registration.surfaces)) throw new WorkSurfaceError('unauthorized', 'Operation batch does not match its admitted Registration')
    const authorize = async (identity: RuntimeContractIdentity, handle: string, capability: 'emitOn' | 'surfaceOutputFrom', producer: 'orchestrate' | 'surface-session'): Promise<RuntimeEventContract> => {
      const route = registration.routes[identity.name]
      const contract = await this.contracts.get(identity.digest)
      if (route === undefined || !route[capability]?.includes(handle) || route.digest !== identity.digest || stableStringify(route.scope) !== stableStringify(identity.scope) || contract.name !== identity.name || stableStringify(contract.scope) !== stableStringify(identity.scope) || !contract.subjects.includes('surface') || !contract.producers.includes(producer)) throw new WorkSurfaceError('unauthorized', `Operation cannot produce '${identity.name}' on '${handle}'`)
      return contract
    }
    for (const effect of batch.events) validatePayload(await authorize(effect.contract, effect.surface, 'emitOn', 'orchestrate'), effect.payload)
    for (const effect of batch.advance) for (const output of effect.outputs) await authorize(output, effect.surface, 'surfaceOutputFrom', 'surface-session')
  }

  private assertSurfaceOutput(contract: RuntimeEventContract, route: OrchestrateRegistrationRecord['routes'][string], name: string): void {
    if (contract.name !== name || stableStringify(contract.scope) !== stableStringify(route.scope) || !contract.producers.includes('surface-session') || !contract.subjects.includes('surface')) throw new WorkSurfaceError('unauthorized', `Surface cannot produce '${name}' through its admitted route`)
  }

  private serialize(key: string, operation: () => Promise<void>): Promise<void> {
    const result = (this.mutations.get(key) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutations.set(key, settled)
    void settled.finally(() => { if (this.mutations.get(key) === settled) this.mutations.delete(key) })
    return result
  }
}

function validateDeclaration(value: unknown, expectedName: string, path: string): asserts value is EventDeclaration {
  const fail = (field: string, requirement: string, expected: string): never => {
    throw new WorkSurfaceError('invalid-definition', `Event declaration '${expectedName}' in '${path}': ${field} ${requirement}`, { eventName: expectedName, path, field, expected })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('$', 'must be a JSON object containing name, description, and payloadSchema', 'object')
  const declaration = value as Record<string, unknown>
  const fields = ['name', 'description', 'payloadSchema']
  const unknown = Object.keys(declaration).find(field => !fields.includes(field))
  if (unknown !== undefined) fail(unknown, 'is not a declaration field; remove it (allowed: name, description, payloadSchema)', 'absent')
  if (declaration.name !== expectedName) fail('name', `must equal the Registration route name ${JSON.stringify(expectedName)}`, expectedName)
  if (typeof declaration.description !== 'string' || declaration.description.length === 0) fail('description', 'must be a non-empty string describing this Event', 'non-empty string')
  if (declaration.payloadSchema === null || typeof declaration.payloadSchema !== 'object' || Array.isArray(declaration.payloadSchema)) fail('payloadSchema', 'must be a JSON object with $schema and type', 'object')
  const schema = declaration.payloadSchema as Record<string, unknown>
  const dialect = 'https://json-schema.org/draft/2020-12/schema'
  if (schema.$schema !== dialect) fail('payloadSchema.$schema', `must equal ${JSON.stringify(dialect)}; set this field explicitly in payloadSchema`, dialect)
  if (schema.type !== 'object') fail('payloadSchema.type', 'must equal "object"; set this field explicitly in payloadSchema', 'object')
}
function toRef(event: RuntimeEventEnvelope): RuntimeEventRef { return { source: 'worksurface', subject: event.subject, seq: event.seq, id: event.id } }
function sortRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> { return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) }
