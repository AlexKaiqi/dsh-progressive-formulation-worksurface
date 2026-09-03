import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  RevisionStore,
  EventContractStore,
  RuntimeEventStore,
  WorkSurfaceError,
  canonicalEventContract,
  eventContractDigest,
  runtimeEventId,
  validatePayload,
  type OrchestrateHistoryBoundary,
  type JsonValue,
  type Revision,
  type RuntimeContractIdentity,
  type RuntimeEventRef,
} from '@pf-worksurface/core'
import { BUILTIN_EVENT_CATALOG } from './builtin-event-catalog.ts'
import type { CodeFirstSurfacePort } from '@pf-worksurface/runtime'
import type { SurfaceSessionService } from './session-surface.ts'

/** Target publication projection and bridge to the Surface's unique DSH Session. */
export class DshCodeFirstSurfacePort implements CodeFirstSurfacePort {
  private readonly mutations = new Map<string, Promise<void>>()
  constructor(
    private readonly ctx: Context,
    private readonly workRoot: string,
    private readonly runtimeRoot: string,
    private readonly revisions: RevisionStore,
    private readonly events: RuntimeEventStore,
    private readonly contracts: EventContractStore,
    private readonly sessions: SurfaceSessionService,
  ) {}

  head(surfaceId: string): Promise<Revision> {
    return this.serialize(surfaceId, () => this.readOrAdmitHead(surfaceId))
  }

  async historyBoundary(surfaceId: string): Promise<OrchestrateHistoryBoundary> {
    const stream = await this.events.replay(surfaceId)
    const binding = this.sessions.bindingForSurface(surfaceId)
    const agent = binding === undefined ? undefined : this.ctx.agents.get(binding.sessionId as never)
    return { surfaceEventSeq: stream.length - 1, externalEventSeq: agent?.session.events.at(-1)?.seq ?? -1 }
  }

  adaptDshToolCompletion(session: Session, event: SessionEvent): { readonly surfaceId: string; readonly ref: RuntimeEventRef } | undefined {
    if (event.type !== 'tool/result') return undefined
    const binding = this.sessions.bindingForSession(String(session.id))
    if (binding === undefined) return undefined
    const callId = String(event.data.message.content[0].toolCallId)
    const call = session.events.slice(0, event.seq).findLast(candidate => candidate.type === 'tool/call' && String(candidate.data.callId) === callId)
    if (call?.type !== 'tool/call') throw new WorkSurfaceError('canonical-corrupt', `DSH tool/result '${callId}' has no preceding tool/call`)
    return {
      surfaceId: binding.surfaceId,
      ref: {
        source: 'external',
        subject: { authority: this.events.authority, kind: 'execution', id: String(session.id) },
        seq: event.seq,
        id: runtimeEventId(this.events.authority, `dsh/${session.id}`, `tool-result-${event.seq}`, binding.surfaceId),
      },
    }
  }

  async resolveExternalInput(ref: RuntimeEventRef): Promise<{ readonly surfaceId: string; readonly name: string; readonly payload: Readonly<Record<string, JsonValue>> }> {
    const source = String(ref.source)
    const subjectKind = String(ref.subject.kind)
    // Legacy DSH refs are accepted only at this adapter boundary. New refs
    // are emitted with the host-neutral external/execution vocabulary.
    if (!['external', 'dsh'].includes(source) || ref.subject.authority !== this.events.authority || !['execution', 'dsh-session'].includes(subjectKind)) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' has an invalid subject`)
    const agent = this.ctx.agents.get(ref.subject.id as never)
    if (agent === undefined) throw new WorkSurfaceError('effect-failed', `DSH Session '${ref.subject.id}' is unavailable while resolving '${ref.id}'`)
    const binding = this.sessions.bindingForSession(ref.subject.id)
    if (binding === undefined) throw new WorkSurfaceError('canonical-corrupt', `DSH Session '${ref.subject.id}' is not bound to a Surface`)
    const event = agent.session.events[ref.seq]
    if (event?.type !== 'tool/result' || event.seq !== ref.seq) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' does not resolve to tool/result`)
    const expectedId = runtimeEventId(this.events.authority, `dsh/${ref.subject.id}`, `tool-result-${event.seq}`, binding.surfaceId)
    if (expectedId !== ref.id) throw new WorkSurfaceError('canonical-corrupt', `DSH EventRef '${ref.id}' failed identity verification`)
    const callId = String(event.data.message.content[0].toolCallId)
    const call = agent.session.events.slice(0, event.seq).findLast(candidate => candidate.type === 'tool/call' && String(candidate.data.callId) === callId)
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
    return this.serialize(surfaceId, async () => {
      const current = await this.readOrAdmitHead(surfaceId)
      if (current === candidateRevision) {
        await this.sessions.adoptRuntimeRevision(surfaceId, candidateRevision)
        return current
      }
      if (current !== baseRevision) throw new WorkSurfaceError('already-exists-conflict', `Surface '${surfaceId}' head changed from '${baseRevision}' to '${current}'`)
      if ((await this.revisions.read(candidateRevision)).kind !== 'surface') throw new WorkSurfaceError('canonical-corrupt', `candidate '${candidateRevision}' is not a Surface Revision`)
      const authoring = this.surfacePath(surfaceId)
      const temporary = join(this.runtimeRoot, 'surface-apply', `${surfaceId}.${randomUUID()}.tmp`)
      const backup = join(this.runtimeRoot, 'surface-apply', `${surfaceId}.${randomUUID()}.backup`)
      await mkdir(dirname(temporary), { recursive: true, mode: 0o700 })
      try {
        await this.revisions.materialize(candidateRevision, temporary)
        if (await exists(authoring)) await rename(authoring, backup)
        await mkdir(dirname(authoring), { recursive: true })
        await rename(temporary, authoring)
        const contract = await this.builtinContract('surface.revision.applied')
        const payload = { registrationId: evidence.registrationId, runId: evidence.runId, baseRevision, revision: candidateRevision }
        validatePayload(contract, payload)
        await this.events.append(surfaceId, {
          id: runtimeEventId(contract.scope.authority, `${evidence.registrationId}/${evidence.runId}`, `apply-${surfaceId}`, surfaceId),
          type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) },
          payload,
          causes: evidence.causes,
          producer: { kind: 'runtime', ref: `${evidence.registrationId}/${evidence.runId}` },
          operationKey: `apply-${surfaceId}`,
        })
        await this.sessions.adoptRuntimeRevision(surfaceId, candidateRevision)
        await rm(backup, { recursive: true, force: true })
        return candidateRevision
      } catch (error) {
        if (!await exists(authoring) && await exists(backup)) await rename(backup, authoring)
        throw error
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    })
  }

  async advance(
    surfaceId: string,
    instruction: string,
    outputs: readonly RuntimeContractIdentity[],
    causes: readonly RuntimeEventRef[],
    operationKey: string,
  ): Promise<{ readonly executionId: string; readonly turnId: string }> {
    const declaredOutputs = await Promise.all(outputs.map(async output => {
      const contract = await this.contracts.get(output.digest)
      return { name: output.name, description: contract.description, payloadSchema: contract.payloadSchema, scope: output.scope, digest: output.digest }
    }))
    this.sessions.prepareTurnBrief(surfaceId, {
      instruction,
      inputs: causes.map((cause, index) => ({ label: `cause-${index + 1}`, summary: `${cause.source} Event ${cause.id}` })),
      outputs: declaredOutputs,
    })
    const message = `${instruction}\n\nRuntime-authorized outputs for this Turn are available in the WorkSurface Turn Brief. Do not infer outputs from this message.`
    const messageId = `ws-advance-${operationKey}`
    const receipt = await this.sessions.followupSurface(surfaceId, message, messageId)
    return { executionId: receipt.sessionId, turnId: receipt.turnId }
  }

  /** Bridge an authorized Surface Turn publication into the target append-only stream. */
  recordPublished(
    surfaceId: string,
    source: { readonly sessionId: string; readonly turn: number; readonly expectedRevision: Revision | null; readonly revision: Revision; readonly summary?: string },
  ): Promise<RuntimeEventRef> {
    return this.serialize(surfaceId, async () => {
      const contract = await this.builtinContract('surface.revision.published')
      const payload = {
        sessionId: source.sessionId,
        turn: source.turn,
        expectedRevision: source.expectedRevision,
        revision: source.revision,
        ...(source.summary === undefined ? {} : { summary: source.summary }),
      }
      validatePayload(contract, payload)
      return this.events.append(surfaceId, {
        id: runtimeEventId(contract.scope.authority, `${source.sessionId}/${source.turn}`, 'surface.revision.published', surfaceId),
        type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) },
        payload,
        causes: [],
        producer: { kind: 'runtime', ref: `${source.sessionId}/${source.turn}` },
        operationKey: 'surface.revision.published',
      })
    })
  }

  async recoverHeads(): Promise<void> {
    const ids = new Set(await this.events.listSurfaces())
    const authoringRoot = resolve(this.workRoot, 'surfaces')
    await mkdir(authoringRoot, { recursive: true })
    for (const entry of await readdir(authoringRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) ids.add(entry.name)
    }
    for (const surfaceId of [...ids].sort()) {
      const revision = await this.head(surfaceId)
      await this.sessions.adoptRuntimeRevision(surfaceId, revision)
    }
  }

  private async readOrAdmitHead(surfaceId: string): Promise<Revision> {
    validateSurfaceId(surfaceId)
    const stream = await this.events.replay(surfaceId)
    const latest = stream.findLast(event => ['surface.revision.admitted', 'surface.revision.applied', 'surface.revision.published'].includes(event.type.name))
    if (latest !== undefined) {
      const revision = latest.payload.revision
      if (typeof revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(revision)) throw new WorkSurfaceError('canonical-corrupt', `Surface '${surfaceId}' revision fact is invalid`)
      if ((await this.revisions.read(revision as Revision)).kind !== 'surface') throw new WorkSurfaceError('canonical-corrupt', `Surface '${surfaceId}' revision fact does not name a Surface Revision`)
      return revision as Revision
    }
    const info = await lstat(this.surfacePath(surfaceId))
    if (!info.isDirectory() || info.isSymbolicLink()) throw new WorkSurfaceError('invalid-working-copy', `Surface '${surfaceId}' authoring path must be a real directory`)
    const revision = (await this.revisions.snapshotSurface(this.surfacePath(surfaceId))).revision
    const contract = await this.builtinContract('surface.revision.admitted')
    const payload = { revision, source: 'authoring' as const }
    validatePayload(contract, payload)
    await this.events.append(surfaceId, {
      id: runtimeEventId(contract.scope.authority, `surface-admission/${surfaceId}`, 'initial-revision', surfaceId),
      type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) },
      payload,
      causes: [],
      producer: { kind: 'runtime', ref: `surface-admission/${surfaceId}` },
      operationKey: 'initial-revision',
    })
    return revision
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
  private surfacePath(surfaceId: string): string { validateSurfaceId(surfaceId); const root = resolve(this.workRoot, 'surfaces'); const path = resolve(root, surfaceId); if (!path.startsWith(`${root}${sep}`)) throw new WorkSurfaceError('unauthorized', 'Surface path escapes authoring root'); return path }
  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> { const previous = this.mutations.get(key) ?? Promise.resolve(); const result = previous.then(operation); const settled = result.then(() => undefined, () => undefined); this.mutations.set(key, settled); void settled.finally(() => { if (this.mutations.get(key) === settled) this.mutations.delete(key) }); return result }
}

function validateSurfaceId(value: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new WorkSurfaceError('invalid-id', `invalid Surface id '${value}'`) }
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
