import { mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import {
  FileWorkspace,
  OperationLedgerStore,
  RevisionStore,
  EventContractStore,
  RuntimeEventStore,
  WorkSurfaceError,
  canonicalEventContract,
  runtimeEventId,
  validatePayload,
  type OrchestrateHistoryBoundary,
  type OrchestrateOperationBatch,
  type JsonValue,
  type Revision,
  type RuntimeContractIdentity,
  type RuntimeEventRef,
} from '@pf-worksurface/core'
import { BUILTIN_EVENT_CATALOG } from './builtin-event-catalog.ts'
import { SurfaceContentRuntime, type CodeFirstSurfacePort } from '@pf-worksurface/runtime'
import type { SurfaceSessionService } from './session-surface.ts'

/** Target publication projection and bridge to the Surface's unique DSH Session. */
export class DshCodeFirstSurfacePort implements CodeFirstSurfacePort {
  readonly workspace: FileWorkspace
  private readonly content: Promise<SurfaceContentRuntime>
  constructor(
    private readonly ctx: Context,
    private readonly workRoot: string,
    runtimeRoot: string,
    revisions: RevisionStore,
    private readonly events: RuntimeEventStore,
    private readonly contracts: EventContractStore,
    private readonly sessions: SurfaceSessionService,
    workspace?: FileWorkspace,
    operations = new OperationLedgerStore(join(runtimeRoot, 'operation-ledger'), events.authority),
  ) {
    this.workspace = workspace ?? new FileWorkspace(workRoot, join(runtimeRoot, 'workspace'), revisions)
    this.content = Promise.all([this.builtinContract('surface.revision.admitted'), this.builtinContract('surface.revision.applied'), this.builtinContract('surface.revision.published')]).then(([admitted, applied, published]) => new SurfaceContentRuntime(this.workspace, join(runtimeRoot, 'surface-content'), events, { admitted, applied, published }, operations))
  }

  head(surfaceId: string): Promise<Revision> {
    return this.content.then(content => content.head(surfaceId))
  }

  async historyBoundary(surfaceId: string): Promise<OrchestrateHistoryBoundary> {
    await this.content
    const stream = await this.events.replay(surfaceId)
    const binding = this.sessions.bindingForSurface(surfaceId)
    const external = binding === undefined ? [] : await this.sessionEvents(binding.sessionId, true)
    return { surfaceEventSeq: stream.length - 1, externalEventSeq: external.at(-1)?.seq ?? -1 }
  }

  adaptDshToolCompletion(session: Session, event: SessionEvent): { readonly surfaceId: string; readonly ref: RuntimeEventRef } | undefined {
    if (event.type !== 'tool/result') return undefined
    const binding = this.sessions.bindingForSession(String(session.id))
    if (binding === undefined) return undefined
    return this.toolCompletion(String(session.id), session.events, event, binding.surfaceId)
  }

  /** Rebuild advisory wakeups from durable host facts without starting an Agent. */
  async recoverExternalInputs(accept: (ref: RuntimeEventRef, surfaceId: string, name: string) => Promise<void>): Promise<readonly { readonly surfaceId: string; readonly error: string }[]> {
    await this.content
    const bindings = this.sessions.listBindings()
    const results = await Promise.all(bindings.map(async binding => {
      const errors = new Set<string>()
      try {
        const history = [...await this.sessionEvents(binding.sessionId, true)]
        for (const event of history) {
          if (event.type !== 'tool/result') continue
          try {
            const adapted = this.toolCompletion(binding.sessionId, history, event, binding.surfaceId)
            // Acceptance owns the immutable Registration history boundary and
            // deduplication. Continue healthy routes after another route fails.
            await accept(adapted.ref, adapted.surfaceId, 'dsh.tool.completed')
          } catch (error) { errors.add(error instanceof Error ? error.message : String(error)) }
        }
      } catch (error) { errors.add(error instanceof Error ? error.message : String(error)) }
      return errors.size === 0 ? [] : [{ surfaceId: binding.surfaceId, error: [...errors].join('; ') }]
    }))
    return results.flat()
  }

  private toolCompletion(sessionId: string, history: readonly SessionEvent[], event: Extract<SessionEvent, { readonly type: 'tool/result' }>, surfaceId: string): { readonly surfaceId: string; readonly ref: RuntimeEventRef } {
    const callId = String(event.data.message.content[0].toolCallId)
    const call = history.slice(0, event.seq).findLast(candidate => candidate.type === 'tool/call' && String(candidate.data.callId) === callId)
    if (call?.type !== 'tool/call') throw new WorkSurfaceError('canonical-corrupt', `DSH tool/result '${callId}' has no preceding tool/call`)
    return {
      surfaceId,
      ref: {
        source: 'external',
        subject: { authority: this.events.authority, kind: 'execution', id: sessionId },
        seq: event.seq,
        id: runtimeEventId(this.events.authority, `dsh/${sessionId}`, `tool-result-${event.seq}`, surfaceId),
      },
    }
  }

  async resolveExternalInput(ref: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }> {
    await this.content
    const source = String(ref.source)
    const subjectKind = String(ref.subject.kind)
    // Legacy DSH refs are accepted only at this adapter boundary. New refs
    // are emitted with the host-neutral external/execution vocabulary.
    if (!['external', 'dsh'].includes(source) || ref.subject.authority !== this.events.authority || !['execution', 'dsh-session'].includes(subjectKind)) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' has an invalid subject`)
    const binding = this.sessions.bindingForSession(ref.subject.id)
    if (binding === undefined) throw new WorkSurfaceError('canonical-corrupt', `DSH Session '${ref.subject.id}' is not bound to a Surface`)
    const history = await this.sessionEvents(ref.subject.id)
    const event = history[ref.seq]
    if (event?.type !== 'tool/result' || event.seq !== ref.seq) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' does not resolve to tool/result`)
    const expectedId = runtimeEventId(this.events.authority, `dsh/${ref.subject.id}`, `tool-result-${event.seq}`, binding.surfaceId)
    if (expectedId !== ref.id) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' failed identity verification`)
    const callId = String(event.data.message.content[0].toolCallId)
    const call = history.slice(0, event.seq).findLast(candidate => candidate.type === 'tool/call' && String(candidate.data.callId) === callId)
    if (call?.type !== 'tool/call') throw new WorkSurfaceError('canonical-corrupt', `DSH tool/result '${callId}' has no preceding tool/call`)
    const failed = event.data.error !== undefined || event.data.message.content[0].isError === true
    const payload = {
      turn: event.data.turn,
      step: event.data.step,
      callId,
      toolName: call.data.name,
      status: failed ? 'failed' : 'succeeded',
      ...(event.data.error === undefined ? {} : { errorCode: event.data.error.code }),
    }
    const contract = await this.builtinContract('dsh.tool.completed')
    validatePayload(contract, payload)
    return { surfaceId: binding.surfaceId, name: contract.name, payload }
  }

  /** @deprecated Use the host-neutral port method; kept for DSH adapter callers. */
  resolveDshInput(ref: RuntimeEventRef) {
    return this.resolveExternalInput(ref)
  }

  apply(
    surfaceId: string,
    baseRevision: Revision,
    candidateRevision: Revision,
    evidence: { readonly registrationId: string; readonly runId: string; readonly causes: readonly RuntimeEventRef[] },
  ): Promise<Revision> {
    return this.content.then(async content => {
      const revision = await content.apply(surfaceId, baseRevision, candidateRevision, evidence)
      await this.sessions.adoptRuntimeRevision(surfaceId, await content.head(surfaceId))
      return revision
    })
  }

  recordBatch(batch: OrchestrateOperationBatch, record: () => Promise<void>): Promise<void> { return this.content.then(content => content.recordBatch(batch, record)) }

  recordedHead(surfaceId: string): Promise<Revision | undefined> { return this.content.then(content => content.recordedHead(surfaceId)) }
  revisionRoots(): Promise<readonly Revision[]> { return this.content.then(content => content.revisionRoots()) }
  recover(): Promise<void> { return this.content.then(content => content.recover()) }

  async publishTurn(surfaceId: string, source: { readonly sessionId: string; readonly turn: number; readonly expectedRevision: Revision | null; readonly summary?: string }, operationKey = 'surface.revision.published'): Promise<RuntimeEventRef> {
    const content = await this.content
    const ref = await content.publish(surfaceId, source.expectedRevision, `${source.sessionId}/${source.turn}`, operationKey, {
      sessionId: source.sessionId, turn: source.turn, ...(source.summary === undefined ? {} : { summary: source.summary }),
    })
    await this.sessions.adoptRuntimeRevision(surfaceId, await content.head(surfaceId))
    return ref
  }

  async advance(
    surfaceId: string,
    instruction: string,
    outputs: readonly RuntimeContractIdentity[],
    causes: readonly RuntimeEventRef[],
    operationKey: string,
  ): Promise<{ readonly executionId: string; readonly turnId: string }> {
    await this.content
    const declaredOutputs = await Promise.all(outputs.map(async output => {
      const contract = await this.contracts.get(output.digest)
      return { name: output.name, description: contract.description, payloadSchema: contract.payloadSchema, scope: output.scope, digest: output.digest }
    }))
    const messageId = `ws-advance-${operationKey}`
    await this.sessions.prepareFollowupBrief(surfaceId, messageId, {
      instruction,
      inputs: causes.map((cause, index) => ({ label: `cause-${index + 1}`, summary: `${cause.source} Event ${cause.id}` })),
      outputs: declaredOutputs,
    })
    const message = `${instruction}\n\nRuntime-authorized outputs for this Turn are available in the WorkSurface Turn Brief. Do not infer outputs from this message.`
    const receipt = await this.sessions.followupSurface(surfaceId, message, messageId)
    return { executionId: receipt.sessionId, turnId: receipt.turnId }
  }

  /** Bridge an authorized Surface Turn publication into the target append-only stream. */
  recordPublished(
    surfaceId: string,
    source: { readonly sessionId: string; readonly turn: number; readonly expectedRevision: Revision | null; readonly revision: Revision; readonly summary?: string },
  ): Promise<RuntimeEventRef> {
    return this.content.then(content => content.publish(surfaceId, source.expectedRevision, `${source.sessionId}/${source.turn}`, 'surface.revision.published', {
      sessionId: source.sessionId, turn: source.turn, ...(source.summary === undefined ? {} : { summary: source.summary }),
    }, source.revision))
  }

  async recoverHeads(options: { readonly isolateFailures?: boolean } = {}): Promise<readonly { readonly surfaceId: string; readonly error: string }[]> {
    await this.recover()
    const recordedSurfaces = new Set(await this.events.listSurfaces())
    const ids = new Set(recordedSurfaces)
    const failures: { surfaceId: string; error: string }[] = []
    const authoringRoot = resolve(this.workRoot, 'surfaces')
    await mkdir(authoringRoot, { recursive: true })
    for (const entry of await readdir(authoringRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) ids.add(entry.name)
    }
    for (const surfaceId of [...ids].sort()) {
      let durable = recordedSurfaces.has(surfaceId)
      try {
        durable ||= await this.recordedHead(surfaceId) !== undefined
        const revision = await this.head(surfaceId)
        durable = true
        await this.sessions.adoptRuntimeRevision(surfaceId, revision)
      } catch (error) {
        // An incomplete authoring directory is not an admitted Surface. Its
        // validation failure must not prevent healthy work from recovering.
        if (options.isolateFailures !== true || durable || (error instanceof WorkSurfaceError && error.code === 'canonical-corrupt')) throw error
        failures.push({ surfaceId, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return failures
  }

  /** Resolving durable input is read-only and never wakes a cold execution. */
  private async sessionEvents(sessionId: string, allowUnmaterialized = false): Promise<readonly SessionEvent[]> {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent !== undefined) return agent.session.events
    const persistence = this.ctx.get?.('sessionPersistence') as {
      inspect(id: ReturnType<typeof SessionId>): Promise<{ readonly meta: SessionHeader; readonly events: readonly SessionEvent[] }>
      list?(): Promise<readonly { readonly id: ReturnType<typeof SessionId> }[]>
    } | undefined
    if (persistence === undefined) throw new WorkSurfaceError('effect-failed', `DSH Session '${sessionId}' has no available live or persisted history`)
    // Binding may precede lazy Session materialization. Only the history
    // boundary accepts that absence; a referenced input must still resolve.
    if (allowUnmaterialized && persistence.list !== undefined && !(await persistence.list()).some(header => String(header.id) === sessionId)) return []
    const inspected = await persistence.inspect(SessionId(sessionId))
    if (String(inspected.meta.id) !== sessionId || !Array.isArray(inspected.events)) throw new WorkSurfaceError('canonical-corrupt', `persisted DSH Session '${sessionId}' has the wrong identity`)
    return inspected.events
  }

  private async builtinContract(name: keyof typeof BUILTIN_EVENT_CATALOG) {
    const builtin = BUILTIN_EVENT_CATALOG[name]
    if (builtin === undefined) throw new WorkSurfaceError('canonical-corrupt', `built-in Event '${name}' is absent from the Runtime catalog`)
    const contract = canonicalEventContract({
      version: 1,
      scope: { authority: this.events.authority, kind: 'builtin', id: 'worksurface' },
      name,
      description: builtin.description,
      subjects: builtin.subjects,
      producers: builtin.producers,
      payloadSchema: builtin.payloadSchema,
    })
    await this.contracts.put(contract)
    return contract
  }
}
