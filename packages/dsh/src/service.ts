import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  DefinitionStore,
  EventContractStore,
  FileEventStore,
  InputLedgerStore,
  OperationLedgerStore,
  RegistrationRecordStore,
  RegistrationStatusStore,
  RevisionStore,
  RuntimeAuthorityStore,
  RuntimeEventStore,
  WorkSurfaceError,
  defineOrchestration,
  eventContractDigest,
  projectSurfaceLifecycle,
  stableStringify,
  runtimeEventId,
  validatePayload,
  type EventRef,
  type JsonValue,
  type Revision,
  type RevisionGcResult,
  type SurfaceLifecycleProjection,
  type WorkSurfaceEvent,
  type RuntimeEventRef,
  type WorkSurfaceViewDefinition,
} from '@pf-worksurface/core'
import type { WorkSurfaceRpcCall } from '@pf-worksurface/cli'
import { SubprocessCodeHandlerRunner } from './code-handler.ts'
import { CONFIG_SCHEMA, resolveConfig, type Config, type WorkSurfaceConfig } from './config.ts'
import { WorkSurfaceEngine, type OrchestrationInspection } from '@pf-worksurface/runtime'
import { WorkSurfaceHost } from './host.ts'
import { SurfaceSessionAdmission, type SurfaceSessionAdmissionRequest, type SurfaceSessionAdmissionResult } from './session-admission.ts'
import { SurfaceSessionService, type SurfaceInputSource, type SurfaceSessionBinding, type SurfaceSessionGcResult } from './session-surface.ts'
import { installDshSessionAdapter } from './session-adapter.ts'
import { WorkSurfaceContextRuntime } from './context/runtime.ts'
import { BUILTIN_EVENT_CATALOG } from './builtin-event-catalog.ts'
import { CodeFirstOrchestrator, type CodeFirstRegistrationInspection } from '@pf-worksurface/runtime'
import { DshCodeFirstSurfacePort } from './code-first-surface-port.ts'
import { installBlockToFileAdapter } from './block-to-file-adapter.ts'
import { SubprocessOrchestrateCodeRunner } from './orchestrate-code-runner.ts'
import { WORKSURFACE_GLOBAL_INSTRUCTIONS, WORKSURFACE_PROMPT_ORDER, WORKSURFACE_PROMPT_SECTION } from './model/global-instructions.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { workSurfaces: WorkSurfaceService }
}

export interface OrchestrationSummary {
  readonly orchestrationId: string
  readonly registrationId: string
  readonly definitionRevision: Revision
  readonly status: 'active' | 'paused' | 'retired'
  readonly bindings: Readonly<Record<string, string>>
  readonly subscriptionCount: number
  readonly activationCount: number
  readonly pendingOperationCount: number
}

export interface SurfaceTopologyNode {
  readonly surfaceId: string
  readonly title: string
  readonly group?: string
  readonly lifecycle: SurfaceLifecycleProjection
  /** Head revision recorded by the code-first runtime (undefined when never published). */
  readonly revision?: Revision
  /** True when the code-first runtime observed a business `*.completed` Event. */
  readonly completed?: boolean
  /** Recorded time of the most recent `surface.revision.published` runtime event. */
  readonly lastPublishedAt?: string
}

export interface SurfaceChoice { readonly surfaceId: string; readonly title: string; readonly revision?: Revision }

interface AuthoringRegistration {
  readonly version: 1
  readonly registrationId: string
  readonly bindings: Readonly<Record<string, string>>
}

export interface TopologyInspection {
  readonly anchorSurfaceId: string
  readonly surfaces: readonly SurfaceTopologyNode[]
  readonly orchestrations: readonly OrchestrationInspection[]
  readonly codeFirst: readonly CodeFirstRegistrationInspection[]
  readonly runtimeEvents: Readonly<Record<string, readonly import('@pf-worksurface/core').RuntimeEventEnvelope[]>>
  readonly view?: WorkSurfaceViewDefinition
}

export interface LegacyDataReport {
  readonly status: 'read-only'
  readonly detected: boolean
  readonly v2Present: boolean
  readonly v3Present: boolean
}

export interface WorkSurfaceGcResult {
  readonly revisions: RevisionGcResult
  readonly sessions: SurfaceSessionGcResult
  /** @deprecated Use sessions. */
  readonly worktrees: SurfaceSessionGcResult
}

/** Cordis assembly around file events, immutable revisions, and existing DSH Sessions. */
export class WorkSurfaceService extends Service {
  static inject = [
    'subprocess',
    'shellEnv',
    'sandbox',
    'agents',
    'agentDefaultModel',
    'sessions',
    'sessionPersistence',
    'workspaceRegistry',
    'systemPrompt',
  ]
  static Config = CONFIG_SCHEMA

  readonly config: WorkSurfaceConfig
  readonly eventStore: FileEventStore
  readonly revisions: RevisionStore
  readonly surfaces: SurfaceSessionService
  readonly sessionAdmission: SurfaceSessionAdmission
  readonly engine: WorkSurfaceEngine
  readonly contextRuntime: WorkSurfaceContextRuntime
  private readonly host: WorkSurfaceHost
  private readonly registrationIds = new Set<string>()
  private readonly authoringFailures = new Map<string, string>()
  private readonly initialization: Promise<void>
  private readonly startupRecovery: Promise<void>
  private wakeQueued = false
  private codeFirst?: CodeFirstOrchestrator
  private codeFirstEvents?: RuntimeEventStore
  private codeFirstSurfacePort?: DshCodeFirstSurfacePort

  constructor(ctx: Context, config: Config) {
    super(ctx, 'workSurfaces')
    this.config = resolveConfig(config)
    ctx.systemPrompt.section({
      name: WORKSURFACE_PROMPT_SECTION,
      order: WORKSURFACE_PROMPT_ORDER,
      text: WORKSURFACE_GLOBAL_INSTRUCTIONS,
    })
    this.eventStore = new FileEventStore(this.config.eventRoot)
    this.revisions = new RevisionStore(this.config.revisionRoot)
    this.surfaces = new SurfaceSessionService(this.eventStore, this.revisions, this.config.workRoot, this.config.root)
    this.contextRuntime = new WorkSurfaceContextRuntime(ctx, {
      revisions: this.revisions,
      runtimeRoot: this.config.runtimeRoot,
      tokenBudget: () => 128_000,
    })
    this.engine = new WorkSurfaceEngine(
      new DefinitionStore(this.config.definitionRoot, this.revisions),
      this.surfaces,
      new SubprocessCodeHandlerRunner(ctx, this.config.runtimeRoot, this.revisions),
    )
    this.host = new WorkSurfaceHost(this.config.socketPath, this)

    const lifecycle = ctx.effect(async () => {
      await Promise.all([
        mkdir(this.config.runtimeRoot, { recursive: true, mode: 0o700 }),
        mkdir(join(this.config.workRoot, 'surfaces'), { recursive: true }),
        mkdir(join(this.config.workRoot, 'orchestrations'), { recursive: true }),
        this.eventStore.init(),
        this.revisions.init(),
      ])
      for (const id of await this.eventStore.list('registration')) this.registrationIds.add(id)
      const unwatch = this.eventStore.watch(event => {
        if (event.subject.kind === 'surface' || event.name === 'registration.operation-recorded') this.queueReconcile()
      })
      await this.host.start()
      this.surfaces.registerTurnTransport(this.config.socketPath)
      installDshSessionAdapter(ctx, this.surfaces, this.contextRuntime, this.config.socketPath, async surfaceId => {
        const result = await this.ensureSession({ surfaceId })
        return { sessionId: result.sessionId }
      }, surfaceId => this.prepareNextTurn(surfaceId))
      const authority = await new RuntimeAuthorityStore(this.config.targetRoot).init()
      this.surfaces.registerRuntimeAuthority(authority.id)
      const targetContracts = new EventContractStore(join(this.config.targetRoot, 'contracts'))
      const targetEvents = new RuntimeEventStore(join(this.config.targetRoot, 'events'), authority.id, targetContracts)
      const targetRegistrations = new RegistrationRecordStore(join(this.config.targetRoot, 'registrations'), authority.id)
      const targetStatuses = new RegistrationStatusStore(join(this.config.targetRoot, 'registration-status'), authority.id)
      const targetInputs = new InputLedgerStore(join(this.config.targetRoot, 'input-ledgers'), authority.id)
      const targetOperations = new OperationLedgerStore(join(this.config.targetRoot, 'operation-ledger'), authority.id)
      const targetSurfaces = new DshCodeFirstSurfacePort(ctx, this.config.workRoot, this.config.targetRoot, this.revisions, targetEvents, targetContracts, this.surfaces, undefined, targetOperations)
      installBlockToFileAdapter(ctx, targetSurfaces.workspace, this.surfaces)
      this.surfaces.registerRevisionHead(surfaceId => targetSurfaces.recordedHead(surfaceId))
      await targetSurfaces.recover()
      await this.surfaces.init()
      const codeFirst = new CodeFirstOrchestrator(
        authority.id,
        this.revisions,
        targetContracts,
        targetEvents,
        targetRegistrations,
        targetStatuses,
        targetInputs,
        targetOperations,
        new SubprocessOrchestrateCodeRunner(ctx, this.config.targetRoot, this.revisions),
        targetSurfaces,
        BUILTIN_EVENT_CATALOG,
      )
      this.codeFirst = codeFirst
      this.codeFirstEvents = targetEvents
      this.codeFirstSurfacePort = targetSurfaces
      const unwatchTarget = targetEvents.watch(event => { void this.initialization.then(() => codeFirst.accept(event)).catch(error => ctx.logger.warn(`WorkSurface code-first reconcile failed: ${renderError(error)}`)) })
      await codeFirst.init({ recover: false })
      await this.collectGarbage()
      const surfaceFailures = await targetSurfaces.recoverHeads({ isolateFailures: true })
      for (const failure of surfaceFailures) ctx.logger.warn(`WorkSurface unfinished authoring Surface '${failure.surfaceId}': ${failure.error}`)
      await this.syncAuthoringRegistrations({ isolateFailures: true })
      for (const binding of this.surfaces.listBindings()) await this.prepareNextTurn(binding.surfaceId)
      ctx.on('session/event', (session, event) => {
        const adapted = targetSurfaces.adaptDshToolCompletion(session, event)
        if (adapted !== undefined) void this.initialization.then(() => codeFirst.acceptExternal(adapted.ref, adapted.surfaceId, 'dsh.tool.completed')).catch(error => ctx.logger.warn(`WorkSurface DSH Event adapter failed: ${renderError(error)}`))
      })
      await this.surfaces.recover()
      return async () => { unwatchTarget(); unwatch(); await this.host.close() }
    }, 'worksurface.v1SessionIntegration()')
    this.initialization = Promise.resolve(lifecycle).then(() => undefined)
    this.sessionAdmission = new SurfaceSessionAdmission(ctx, this.surfaces, () => this.initialization)
    this.startupRecovery = this.initialization.then(async () => {
      const externalFailures = await this.codeFirstSurfacePort?.recoverExternalInputs((ref, surfaceId, name) => this.codeFirst!.acceptExternal(ref, surfaceId, name)) ?? []
      for (const failure of externalFailures) ctx.logger.warn(`WorkSurface external input recovery for '${failure.surfaceId}': ${failure.error}`)
      const runtime = await this.codeFirst?.recover()
      for (const failure of runtime?.failedRegistrations ?? []) ctx.logger.warn(`WorkSurface startup runtime recovery remains unfinished: ${JSON.stringify(failure)}`)
      const sessions = await this.sessionAdmission.recoverAfterRestart()
      const registrations = [...this.registrationIds].sort()
      const reconciled = await Promise.allSettled(registrations.map(id => this.engine.reconcile(id)))
      for (const [index, result] of reconciled.entries()) {
        if (result.status === 'rejected') {
          ctx.logger.warn(`WorkSurface startup reconcile '${registrations[index]}' failed: ${renderError(result.reason)}`)
        }
      }
      const failedRegistrations = reconciled.filter(result => result.status === 'rejected').length
      ctx.logger.info(
        `WorkSurface startup recovery resumed ${sessions.length} Session(s); `
        + `reconciled ${registrations.length - failedRegistrations}/${registrations.length} Registration(s)`,
      )
    })
  }

  async [Service.init](): Promise<void> { await this.startupRecovery }

  emitEvent(
    surfaceId: string,
    name: string,
    payload: JsonValue,
    options: { readonly eventId?: string; readonly causes?: readonly EventRef[] } = {},
  ): Promise<EventRef> {
    return this.surfaces.appendSurface(surfaceId, {
      id: options.eventId ?? `evt_${randomUUID()}`,
      name,
      payload,
      causes: options.causes ?? [],
    })
  }

  async emitTurn(capability: string, name: string, payload: JsonValue, operationKey?: string): Promise<EventRef | RuntimeEventRef> {
    // Compatibility for callers predating the separate file publication command.
    if (name === 'surface.revision.published') {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'summary') || (payload.summary !== undefined && typeof payload.summary !== 'string')) throw new WorkSurfaceError('invalid-working-copy', 'publication accepts only an optional string summary')
      return this.publishTurn(capability, operationKey ?? name, typeof payload.summary === 'string' ? payload.summary : undefined)
    }
    const source = this.surfaces.planningSource(capability)
    await this.syncAuthoringRegistrations()
    const target = await this.codeFirst?.surfaceOutput(source.surfaceId, name)
    if (target !== undefined) {
      const authorization = this.surfaces.activeSurface(source.sessionId)?.runtimeBinding?.contracts[name]
      const route = target.registration.routes[name]!
      if (authorization === undefined || authorization.digest !== route.digest || stableStringify(authorization.scope) !== stableStringify(route.scope) || !authorization.capabilities.includes('surface-output')) {
        throw new WorkSurfaceError('unauthorized', `Event '${name}' is not authorized by the current Turn Brief`)
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new WorkSurfaceError('invalid-working-copy', `payload for '${name}' must be an object`)
      validatePayload(target.contract, payload)
      const key = operationKey ?? name
      return this.codeFirstEvents!.append(source.surfaceId, {
        id: runtimeEventId(this.codeFirst!.authority, `${source.sessionId}/${source.turn}`, key, source.surfaceId),
        type: { scope: target.contract.scope, name, contract: target.registration.routes[name]!.digest },
        payload,
        causes: [],
        producer: { kind: 'surface-session', ref: `${source.sessionId}/${source.turn}` },
        operationKey: key,
      })
    }
    if (name in BUILTIN_EVENT_CATALOG) throw new WorkSurfaceError('unauthorized', `built-in '${name}' is emitted by its host adapter or runtime`)
    return this.surfaces.emitTurn(capability, name, payload, operationKey)
  }

  /** Publish this active Turn's Surface files, independently of business outputs. */
  async publishTurn(capability: string, operationKey: string, summary?: string): Promise<RuntimeEventRef> {
    const source = this.surfaces.planningSource(capability)
    if (typeof operationKey !== 'string' || operationKey.trim() === '') throw new WorkSurfaceError('invalid-working-copy', 'file publication requires a stable operation key')
    if (summary !== undefined && typeof summary !== 'string') throw new WorkSurfaceError('invalid-working-copy', 'file publication summary must be a string')
    if (this.codeFirstSurfacePort === undefined) throw new WorkSurfaceError('effect-failed', 'file publication is unavailable')
    const active = this.surfaces.activeSurface(source.sessionId)!
    if (resolve(active.cwd) !== resolve(this.surfaces.workRoot, 'surfaces', source.surfaceId)) {
      throw new WorkSurfaceError('unauthorized', 'file publication requires the public Surface authoring directory; this legacy Session still uses a private worktree')
    }
    return this.codeFirstSurfacePort.publishTurn(source.surfaceId, {
      sessionId: source.sessionId, turn: source.turn, expectedRevision: active.revision.expectedHead,
      ...(summary === undefined ? {} : { summary }),
    }, operationKey)
  }

  /** Called by the creator during DSH Agent setup, before the Surface Session starts. */
  async bindSession(session: Session, surfaceId: string, source?: SurfaceInputSource): Promise<SurfaceSessionBinding> {
    await this.codeFirstSurfacePort?.head(surfaceId)
    return this.surfaces.bindSession(session, surfaceId, source)
  }

  /** Use this as CreateAgentOptions.meta.cwd before calling bindSession in setup. */
  cwdForSurface(surfaceId: string): string { return this.surfaces.cwdForSurface(surfaceId) }

  /** Product admission: create or resume the Surface's one real DSH Session without starting a Turn. */
  async ensureSession(request: SurfaceSessionAdmissionRequest): Promise<SurfaceSessionAdmissionResult> {
    await this.codeFirstSurfacePort?.head(request.surfaceId)
    const result = await this.sessionAdmission.ensure(request)
    await this.prepareNextTurn(request.surfaceId)
    return result
  }

  replayEvents(surfaceId: string, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]> {
    return this.surfaces.replaySurface(surfaceId, fromSeq)
  }

  /** Wakeup only. Callers must rebuild their projection after it resolves. */
  waitForProjectionWake(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const unwatch = this.eventStore.watch(() => finish())
      const cleanup = (): void => { unwatch(); signal.removeEventListener('abort', abort) }
      const finish = (): void => { if (!settled) { settled = true; cleanup(); resolve() } }
      const abort = (): void => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new WorkSurfaceError('cancelled', 'projection wakeup cancelled'))
        }
      }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  }

  async readRevisionFile(revision: Revision, path: string): Promise<{ revision: Revision; content: string }> {
    return { revision, content: (await this.revisions.readFile(revision, path)).toString('utf8') }
  }

  async registerDefinition(
    orchestrationId: string,
    bindings: Readonly<Record<string, string>>,
    registrationId: string,
  ): Promise<{ orchestrationId: string; registrationId: string; definitionRevision: Revision }> {
    validateAuthorId(orchestrationId, 'Orchestration')
    validateAuthorId(registrationId, 'Registration')
    validateBindings(bindings)

    if ((await this.surfaces.replayRegistration(registrationId)).length > 0) {
      const existing = await this.engine.inspect(registrationId)
      if (existing.orchestrationId === orchestrationId
        && stableStringify(existing.bindings) === stableStringify(bindings)) {
        this.registrationIds.add(registrationId)
        return { orchestrationId, registrationId, definitionRevision: existing.definitionRevision }
      }
      throw new WorkSurfaceError('already-exists-conflict', `Registration '${registrationId}' already fixes different orchestration facts`)
    }

    await this.assertAuthoringCollection('orchestrations')
    await this.assertAuthoringCollection('surfaces')
    for (const surfaceId of new Set(Object.values(bindings))) {
      const authoring = this.authorPath('surfaces', surfaceId)
      if (await exists(authoring)) await this.revisions.snapshotSurface(authoring)
      else await this.surfaces.defaultInputSource(surfaceId)
    }

    const directory = this.authorPath('orchestrations', orchestrationId)
    const definitionRevision = (await this.revisions.snapshotDefinition(directory)).revision
    let definition: unknown
    try { definition = JSON.parse((await this.revisions.readFile(definitionRevision, 'definition.json')).toString('utf8')) }
    catch { throw new WorkSurfaceError('invalid-definition', `Orchestration '${orchestrationId}' has invalid definition.json`) }
    definition = defineOrchestration(definition).definition

    const result = await this.engine.register({ orchestrationId, registrationId, definitionRevision, definition: definition as never, bindings })
    this.registrationIds.add(registrationId)
    return result
  }

  pauseDefinition(id: string): Promise<void> { return this.engine.pause(id) }
  resumeDefinition(id: string): Promise<void> { return this.engine.resume(id) }
  /** Retire a Registration from either the code-first Runtime or the legacy engine. */
  async retireDefinition(id: string): Promise<void> {
    if (this.codeFirst !== undefined) {
      try { await this.codeFirst.retire(id); return }
      catch (error) {
        if (!(error instanceof WorkSurfaceError) || error.code !== 'not-found') throw error
      }
    }
    await this.engine.retire(id)
  }
  inspectOrchestration(id: string): Promise<OrchestrationInspection> { return this.engine.inspect(id) }

  async listOrchestrations(surfaceId?: string): Promise<readonly OrchestrationSummary[]> {
    const inspections = await Promise.all([...this.registrationIds].sort().map(id => this.engine.inspect(id)))
    return inspections.flatMap(inspection => surfaceId !== undefined && !Object.values(inspection.bindings).includes(surfaceId) ? [] : [{
      orchestrationId: inspection.orchestrationId,
      registrationId: inspection.registrationId,
      definitionRevision: inspection.definitionRevision,
      status: inspection.status,
      bindings: inspection.bindings,
      subscriptionCount: inspection.definition.subscriptions.length,
      activationCount: inspection.activations.length,
      pendingOperationCount: inspection.pendingOperations.length,
    }])
  }

  async inspectTopology(surfaceId: string, view?: WorkSurfaceViewDefinition): Promise<TopologyInspection> {
    const all = await Promise.all([...this.registrationIds].sort().map(id => this.engine.inspect(id)))
    const targetAll = await this.codeFirst?.inspectRegistrations() ?? []
    const surfaceIds = new Set([surfaceId])
    const included = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const inspection of all) {
        if (included.has(inspection.registrationId)) continue
        const bound = Object.values(inspection.bindings)
        if (!bound.some(id => surfaceIds.has(id))) continue
        included.add(inspection.registrationId)
        for (const id of bound) if (!surfaceIds.has(id)) { surfaceIds.add(id); changed = true }
      }
      for (const inspection of targetAll) {
        if (included.has(`v5:${inspection.registrationId}`)) continue
        const bound = Object.values(inspection.bindings)
        if (!bound.some(id => surfaceIds.has(id))) continue
        included.add(`v5:${inspection.registrationId}`)
        for (const id of bound) if (!surfaceIds.has(id)) { surfaceIds.add(id); changed = true }
      }
    }
    const orchestrations = all.filter(inspection => included.has(inspection.registrationId))
    const codeFirst = targetAll.filter(inspection => included.has(`v5:${inspection.registrationId}`))
    const runtimeEvents = Object.fromEntries(await Promise.all([...surfaceIds].sort().map(async id => [id, await this.codeFirstEvents?.replay(id) ?? []] as const)))
    const surfaces = await Promise.all([...surfaceIds].sort().map(async id => {
      const events = await this.replayEvents(id)
      const configured = view?.surfaces?.[id]
      const runtime = runtimeEvents[id] ?? []
      // Durable run evidence lives in the code-first runtime event stream;
      // the legacy surface projection alone stays `idle` because the legacy
      // stream is empty. Keep publication distinct from business completion.
      const published = [...runtime].reverse().find(event => event.type.name === 'surface.revision.published')
      const revision = await this.codeFirstSurfacePort?.recordedHead(id)
      const completed = runtime.some(event => event.type.name.endsWith('.completed'))
      return {
        surfaceId: id,
        title: configured?.title ?? await this.surfaceTitle(id),
        ...(configured?.group === undefined ? {} : { group: configured.group }),
        lifecycle: projectSurfaceLifecycle(events.map(event => ({ ref: { subject: `surface:${id}`, seq: event.seq, id: event.id }, event })), view?.interpretations ?? [], id),
        ...(revision === undefined ? {} : { revision }),
        ...(published === undefined ? {} : { lastPublishedAt: published.recordedAt }),
        ...(completed ? { completed: true } : {}),
      }
    }))
    return { anchorSurfaceId: surfaceId, surfaces, orchestrations, codeFirst, runtimeEvents, ...(view === undefined ? {} : { view }) }
  }

  async listSurfaces(): Promise<readonly SurfaceChoice[]> {
    const ids = new Set(await this.eventStore.list('surface'))
    for (const id of await this.codeFirstEvents?.listSurfaces() ?? []) ids.add(id)
    for (const registration of await this.codeFirst?.inspectRegistrations() ?? []) for (const surfaceId of Object.values(registration.bindings)) ids.add(surfaceId)
    for (const registrationId of this.registrationIds) {
      const inspection = await this.engine.inspect(registrationId)
      for (const surfaceId of Object.values(inspection.bindings)) ids.add(surfaceId)
    }
    try {
      for (const entry of await readdir(join(this.config.workRoot, 'surfaces'), { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return Promise.all([...ids].sort().map(async surfaceId => {
      const revision = await this.codeFirstSurfacePort?.recordedHead(surfaceId)
      return { surfaceId, title: await this.surfaceTitle(surfaceId), ...(revision === undefined ? {} : { revision }) }
    }))
  }

  async inspectLegacyData(): Promise<LegacyDataReport> {
    const v2Present = await exists(join(dirname(this.config.root), 'v2'))
    const v3Present = await exists(join(dirname(this.config.root), 'v3'))
    return { status: 'read-only', detected: v2Present || v3Present, v2Present, v3Present }
  }

  /** Collect only old immutable objects that no durable Event fact or pin can reach. */
  async collectGarbage(minAgeMs = 7 * 24 * 60 * 60 * 1_000): Promise<WorkSurfaceGcResult> {
    const roots = [
      ...await this.codeFirst?.revisionRoots() ?? [],
      ...await this.codeFirstSurfacePort?.revisionRoots() ?? [],
    ]
    const revisions = await this.surfaces.collectGarbage(minAgeMs, roots)
    const sessions = await this.surfaces.collectSessionGarbage(minAgeMs)
    return { revisions, sessions, worktrees: sessions }
  }

  async dispatch(call: WorkSurfaceRpcCall, signal: AbortSignal): Promise<unknown> {
    await this.initialization
    const p = call.params
    switch (call.method) {
      case 'authoring.sync': {
        await this.syncAuthoringRegistrations()
        await this.codeFirstSurfacePort?.recoverHeads()
        return { surfaces: await this.listSurfaces(), registrations: await this.codeFirst?.inspectRegistrations() ?? [] }
      }
      case 'surface.list': return this.listSurfaces()
      case 'surface.run': {
        const surfaceId = text(p, 'surfaceId')
        const instruction = text(p, 'instruction')
        const key = text(p, 'operationKey')
        await this.ensureSession({ surfaceId })
        return this.surfaces.followupSurface(surfaceId, instruction, `ws-request-${key}`)
      }
      case 'surface.publish': {
        if (Object.keys(p).some(key => !['capability', 'operationKey', 'summary'].includes(key))) throw new WorkSurfaceError('invalid-working-copy', 'file publication accepts only capability, operationKey, and optional summary')
        if (p.summary !== undefined && typeof p.summary !== 'string') throw new WorkSurfaceError('invalid-working-copy', 'file publication summary must be a string')
        return this.publishTurn(text(p, 'capability'), text(p, 'operationKey'), p.summary)
      }
      case 'runtime.recover': {
        const surfaceFailures = await this.codeFirstSurfacePort?.recoverHeads({ isolateFailures: true }) ?? []
        await this.surfaces.recover()
        await this.syncAuthoringRegistrations({ isolateFailures: true })
        const externalFailures = await this.codeFirstSurfacePort?.recoverExternalInputs((ref, surfaceId, name) => this.codeFirst!.acceptExternal(ref, surfaceId, name)) ?? []
        const runtime = await this.codeFirst?.recover()
        return { runtime, surfaceFailures, externalFailures, registrations: await this.codeFirst?.inspectRegistrations() ?? [], authoringFailures: Object.fromEntries(this.authoringFailures) }
      }
      case 'event.emit': {
        const eventId = optionalText(p, 'eventId')
        return this.emitEvent(text(p, 'surfaceId'), text(p, 'name'), json(p.payload), {
          ...(eventId === undefined ? {} : { eventId }),
        })
      }
      case 'event.emit-turn': return this.emitTurn(text(p, 'capability'), text(p, 'name'), json(p.payload), optionalText(p, 'operationKey'))
      case 'event.replay': return this.replayEvents(text(p, 'surfaceId'), optionalInteger(p, 'fromSeq'))
      case 'event.watch': return this.waitForEvents(text(p, 'surfaceId'), optionalInteger(p, 'fromSeq'), signal)
      case 'orchestrate.pause': await this.pauseDefinition(text(p, 'registrationId')); return { status: 'paused' }
      case 'orchestrate.resume': await this.resumeDefinition(text(p, 'registrationId')); return { status: 'active' }
      case 'orchestrate.retire': await this.retireDefinition(text(p, 'registrationId')); return { status: 'retired' }
      case 'orchestrate.show': return this.inspectOrchestration(text(p, 'registrationId'))
      case 'orchestrate.list': return this.listOrchestrations(optionalText(p, 'surfaceId'))
      case 'topology.show': return this.inspectTopology(text(p, 'surfaceId'))
      case 'revision.read': return this.revisions.read(text(p, 'revision') as Revision)
      case 'revision.materialize': {
        const path = this.materializationPath(text(p, 'path'))
        if (this.codeFirstSurfacePort === undefined) throw new WorkSurfaceError('effect-failed', 'file workspace is unavailable')
        await this.codeFirstSurfacePort.workspace.materialize(text(p, 'revision') as Revision, relative(this.config.workRoot, path), `rpc-materialize:${call.id}`)
        return { path }
      }
      case 'legacy.report': return this.inspectLegacyData()
    }
  }

  private async syncAuthoringRegistrations(options: { readonly isolateFailures?: boolean } = {}): Promise<void> {
    const root = await this.assertAuthoringCollection('orchestrations')
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      try {
        await this.syncAuthoringRegistration(root, entry.name)
        this.authoringFailures.delete(entry.name)
      } catch (error) {
        const message = renderError(error)
        if (options.isolateFailures !== true) {
          if (this.authoringFailures.get(entry.name) === message) continue
          throw error
        }
        if (this.authoringFailures.get(entry.name) !== message) {
          this.ctx.logger.warn(`WorkSurface authoring Orchestration '${entry.name}' was skipped: ${message}`)
          this.authoringFailures.set(entry.name, message)
        }
      }
    }
  }

  private async syncAuthoringRegistration(root: string, orchestrationId: string): Promise<void> {
    const manifest = join(root, orchestrationId, 'registration.json')
    let info: Awaited<ReturnType<typeof lstat>>
    try { info = await lstat(manifest) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new WorkSurfaceError('invalid-definition', `Orchestration '${orchestrationId}' registration.json must be a regular file`)
    }
    const artifact = join(root, orchestrationId, 'artifact')
    if (await exists(artifact)) {
      if (this.codeFirst === undefined) throw new WorkSurfaceError('effect-failed', 'code-first Runtime is not initialized')
      await this.codeFirst.admit(manifest, artifact)
      return
    }
    const registration = parseAuthoringRegistration(await readFile(manifest, 'utf8'))
    await this.registerDefinition(orchestrationId, registration.bindings, registration.registrationId)
  }

  private async prepareNextTurn(surfaceId: string): Promise<void> {
    if (this.codeFirst === undefined) return
    await this.syncAuthoringRegistrations({ isolateFailures: true })
    const outputs = await this.codeFirst.surfaceOutputs(surfaceId)
    this.surfaces.prepareTurnBrief(surfaceId, {
      instruction: 'Follow the user message entering this Turn and the current Surface acceptance criteria.',
      outputs: outputs.map(contract => ({ name: contract.name, description: contract.description, payloadSchema: contract.payloadSchema, scope: contract.scope, digest: eventContractDigest(contract) })),
    })
  }

  private waitForEvents(surfaceId: string, fromSeq: number | undefined, signal: AbortSignal): Promise<readonly WorkSurfaceEvent[]> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = this.eventStore.watch(event => { if (event.subject.kind === 'surface' && event.subject.id === surfaceId) replay() })
      const finish = (events: readonly WorkSurfaceEvent[]): void => { if (!settled && events.length > 0) { settled = true; cleanup(); signal.removeEventListener('abort', abort); resolve(events) } }
      const fail = (error: unknown): void => { if (!settled) { settled = true; cleanup(); signal.removeEventListener('abort', abort); reject(error) } }
      const replay = (): void => { void this.replayEvents(surfaceId, fromSeq).then(finish, fail) }
      const abort = (): void => fail(new WorkSurfaceError('cancelled', 'event watch cancelled'))
      if (signal.aborted) abort()
      else { signal.addEventListener('abort', abort, { once: true }); replay() }
    })
  }

  private queueReconcile(): void {
    if (this.wakeQueued) return
    this.wakeQueued = true
    queueMicrotask(() => {
      this.wakeQueued = false
      void Promise.all([...this.registrationIds].map(id => this.engine.reconcile(id))).catch(error => this.ctx.logger.warn(`WorkSurface reconcile failed: ${String(error)}`))
    })
  }

  private async surfaceTitle(surfaceId: string): Promise<string> {
    try {
      const markdown = await readFile(join(this.authorPath('surfaces', surfaceId), 'surface.md'), 'utf8')
      const goal = markdown.split(/^# Acceptance Criteria\s*$/m)[0]?.replace(/^# Goal\s*/m, '').trim().split('\n').find(line => line.trim() !== '')?.trim()
      if (goal !== undefined) return goal.slice(0, 120)
    } catch { /* deterministic id fallback */ }
    return surfaceId
  }

  private async assertAuthoringCollection(collection: 'surfaces' | 'orchestrations'): Promise<string> {
    const root = resolve(this.config.workRoot, collection)
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WorkSurfaceError('invalid-working-copy', `WorkSurface authoring root '${collection}' must be a real directory`)
    }
    return root
  }

  private authorPath(collection: 'surfaces' | 'orchestrations', id: string): string {
    const root = resolve(this.config.workRoot, collection)
    const path = resolve(root, id)
    if (!path.startsWith(`${root}${sep}`)) throw new WorkSurfaceError('unauthorized', `${collection} path escapes authoring root`)
    return path
  }

  private materializationPath(input: string): string {
    const root = resolve(this.config.workRoot)
    const path = resolve(input)
    if (!path.startsWith(`${root}${sep}`)) throw new WorkSurfaceError('unauthorized', 'revision materialization target must be inside the configured work root')
    return path
  }
}

function text(record: Readonly<Record<string, unknown>>, key: string): string { const value = record[key]; if (typeof value !== 'string' || value === '') throw invalid(key); return value }
function optionalText(record: Readonly<Record<string, unknown>>, key: string): string | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'string' || value === '') throw invalid(key); return value }
function optionalInteger(record: Readonly<Record<string, unknown>>, key: string): number | undefined { const value = record[key]; if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(key); return value as number }
function json(value: unknown): JsonValue { try { JSON.stringify(value) } catch { throw invalid('payload') } return value as JsonValue }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function invalid(key: string): WorkSurfaceError { return new WorkSurfaceError('invalid-working-copy', `invalid RPC parameter '${key}'`) }
function renderError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function validateAuthorId(value: string, label: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new WorkSurfaceError('invalid-id', `invalid ${label} id '${value}'`) }
function validateBindings(bindings: Readonly<Record<string, string>>): void {
  if (!isRecord(bindings) || Object.keys(bindings).length === 0) throw new WorkSurfaceError('invalid-definition', 'registration bindings must be a non-empty object')
  for (const [role, surfaceId] of Object.entries(bindings)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(role)) throw new WorkSurfaceError('invalid-definition', `invalid registration role '${role}'`)
    if (typeof surfaceId !== 'string') throw new WorkSurfaceError('invalid-definition', `Surface bound to '${role}' must be a string`)
    validateAuthorId(surfaceId, `Surface bound to '${role}'`)
  }
}
function parseAuthoringRegistration(text: string): AuthoringRegistration {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new WorkSurfaceError('invalid-definition', 'registration.json is not valid JSON') }
  if (!isRecord(value) || value.version !== 1 || typeof value.registrationId !== 'string' || !isRecord(value.bindings)
    || Object.keys(value).some(key => !['version', 'registrationId', 'bindings'].includes(key))) {
    throw new WorkSurfaceError('invalid-definition', 'registration.json must contain only version, registrationId, and bindings')
  }
  validateAuthorId(value.registrationId, 'Registration')
  const bindings = value.bindings as Record<string, string>
  validateBindings(bindings)
  return { version: 1, registrationId: value.registrationId, bindings }
}
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
