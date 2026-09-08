import { lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  FileWorkspace, RuntimeEventStore, WorkSurfaceError, durableCreate, syncDirectory,
  eventContractDigest, runtimeEventId, sha256, stableStringify, validatePayload, validateRuntimeEventEnvelope,
  OperationLedgerStore, type OrchestrateOperationBatch,
  type LockedFileWorkspace, type Revision, type RuntimeEventContract,
  type RuntimeEventDraft, type RuntimeEventEnvelope, type RuntimeEventRef, type JsonValue,
} from '@pf-worksurface/core'

/** Contract identities are supplied by the assembly, never inferred from event names. */
export interface SurfaceRevisionContracts {
  readonly admitted: RuntimeEventContract
  readonly applied: RuntimeEventContract
  readonly published: RuntimeEventContract
}
interface ApplyIntent {
  readonly version: 1
  readonly surfaceId: string
  readonly base: Revision
  readonly candidate: Revision
  readonly draft: RuntimeEventDraft
}

/**
 * Durable Surface content transitions, independent of any Session or editor.
 * The workspace is mutable authoring; the event stream is the published head.
 * Applying a revision compares both, preserving unpublished authoring changes.
 */
export class SurfaceContentRuntime {
  private readonly stateRoot: string
  constructor(
    readonly workspace: FileWorkspace,
    stateRoot: string,
    readonly events: RuntimeEventStore,
    readonly contracts: SurfaceRevisionContracts,
    private readonly operations: OperationLedgerStore,
  ) {
    this.stateRoot = resolve(stateRoot)
    if (this.stateRoot === workspace.root || this.stateRoot.startsWith(`${workspace.root}${sep}`)) throw new WorkSurfaceError('invalid-working-copy', 'Surface journal must be outside authoring files')
    if (operations.authority !== events.authority) throw new WorkSurfaceError('invalid-working-copy', 'Surface content and Operation ledger must share an authority')
    const identities = Object.values(contracts).map(contract => eventContractDigest(contract))
    if (new Set(identities).size !== 3 || Object.values(contracts).some(contract => contract.scope.authority !== events.authority || !contract.subjects.includes('surface') || stableStringify(contract.producers) !== stableStringify(['runtime']))) throw new WorkSurfaceError('invalid-definition', 'Surface revision contracts require distinct identities and exclusive runtime production')
  }

  /** The workspace lock closes the gap between observing bases and reserving them. */
  recordBatch(batch: OrchestrateOperationBatch, record: () => Promise<void>): Promise<void> {
    return this.workspace.transaction(async view => {
      await this.recoverLocked(view)
      if (batch.authority !== this.events.authority) throw new WorkSurfaceError('unauthorized', 'Operation batch belongs to a different authority')
      for (const surface of Object.values(batch.surfaces)) {
        const current = await this.headLocked(view, surface.surfaceId)
        if (current !== surface.baseRevision) throw new WorkSurfaceError('revision-conflict', `Surface '${surface.surfaceId}' changed before its Operation was recorded`, { expected: surface.baseRevision, actual: current })
        await this.assertUnreserved(surface.surfaceId, { registrationId: batch.registrationId, runId: batch.runId })
        if (surface.candidateRevision !== surface.baseRevision) {
          if ((await this.workspace.revisions.read(surface.candidateRevision)).kind !== 'surface') throw new WorkSurfaceError('invalid-working-copy', 'candidate must be a Surface revision')
          await this.workspaceChange(surface.surfaceId, surface.baseRevision, surface.candidateRevision, () => view.checkReplace(prefix(surface.surfaceId), surface.baseRevision, surface.candidateRevision))
        }
      }
      await record()
    })
  }

  head(surfaceId: string): Promise<Revision> {
    return this.workspace.transaction(async view => { await this.recoverLocked(view); return this.headLocked(view, surfaceId) })
  }

  /** Read durable facts without admitting a directory; used before host context recovery. */
  async recordedHead(surfaceId: string): Promise<Revision | undefined> {
    validateId(surfaceId)
    let head: Revision | undefined
    for (const event of await this.events.replay(surfaceId)) {
      const kind = (Object.keys(this.contracts) as (keyof SurfaceRevisionContracts)[]).find(key => this.matches(event, this.contracts[key]))
      if (kind === undefined) continue
      const contract = this.contracts[kind]
      validatePayload(contract, event.payload)
      if (event.producer.kind !== 'runtime') throw new WorkSurfaceError('canonical-corrupt', 'Surface revision fact was not emitted by its runtime')
      const revision = event.payload.revision as Revision
      if ((await this.workspace.revisions.read(revision)).kind !== 'surface') throw new WorkSurfaceError('canonical-corrupt', 'Surface revision fact names a non-Surface revision')
      if (kind === 'admitted' && head !== undefined) throw new WorkSurfaceError('canonical-corrupt', 'Surface was admitted twice')
      const expected = kind === 'applied' ? event.payload.baseRevision : event.payload.expectedRevision
      if (kind !== 'admitted' && expected !== (head ?? null)) throw new WorkSurfaceError('canonical-corrupt', 'Surface revision history has a broken compare-and-swap chain')
      head = revision
    }
    return head
  }

  /** The canonical chain is replayed using every historical immutable revision. */
  async revisionRoots(): Promise<readonly Revision[]> {
    const roots = new Set<Revision>()
    for (const surfaceId of await this.events.listSurfaces()) {
      await this.recordedHead(surfaceId)
      for (const event of await this.events.replay(surfaceId)) if (Object.values(this.contracts).some(contract => this.matches(event, contract))) roots.add(event.payload.revision as Revision)
    }
    return [...roots].sort()
  }

  apply(surfaceId: string, base: Revision, candidate: Revision, evidence: { readonly registrationId: string; readonly runId: string; readonly causes: readonly RuntimeEventRef[] }): Promise<Revision> {
    return this.workspace.transaction(async view => {
      await this.recoverLocked(view)
      const ref = `${evidence.registrationId}/${evidence.runId}`
      const draft = this.draft(this.contracts.applied, surfaceId, ref, `apply-${surfaceId}`, { registrationId: evidence.registrationId, runId: evidence.runId, baseRevision: base, revision: candidate }, evidence.causes)
      const existing = (await this.events.replay(surfaceId)).find(event => event.id === draft.id)
      if (existing !== undefined) { await this.events.append(surfaceId, draft); return candidate }
      const current = await this.headLocked(view, surfaceId)
      if (current !== base) throw new WorkSurfaceError('revision-conflict', `Surface '${surfaceId}' head changed`, { expected: base, actual: current })
      await this.assertUnreserved(surfaceId, evidence)
      if ((await this.workspace.revisions.read(candidate)).kind !== 'surface') throw new WorkSurfaceError('invalid-working-copy', 'candidate must be a Surface revision')
      // A batch that only emits or advances must preserve unrelated ordinary WIP.
      if (candidate === base) { await this.events.append(surfaceId, draft); return candidate }
      await this.workspaceChange(surfaceId, base, candidate, () => view.checkReplace(prefix(surfaceId), base, candidate))
      const intent: ApplyIntent = { version: 1, surfaceId, base, candidate, draft }
      await durableCreate(this.intentPath(draft.id), intent)
      await this.finishApply(view, intent)
      return candidate
    })
  }

  /** Publish an immutable authoring observation; business acceptance remains a separate event. */
  publish(surfaceId: string, expected: Revision | null, producerRef: string, operationKey: string, metadata: Readonly<Record<string, JsonValue>>, observedRevision?: Revision): Promise<RuntimeEventRef> {
    return this.workspace.transaction(async view => {
      await this.recoverLocked(view)
      const current = await this.headLocked(view, surfaceId)
      const id = runtimeEventId(this.events.authority, producerRef, operationKey, surfaceId)
      const existing = (await this.events.replay(surfaceId)).find(event => event.id === id)
      if (existing !== undefined) {
        const { expectedRevision: _expected, revision, ...originalMetadata } = existing.payload
        if (!this.matches(existing, this.contracts.published) || stableStringify(originalMetadata) !== stableStringify(metadata) || (observedRevision !== undefined && revision !== observedRevision)) throw new WorkSurfaceError('already-exists-conflict', 'publication key already names a different request')
        return { source: 'worksurface', subject: existing.subject, seq: existing.seq, id: existing.id }
      }
      await this.assertUnreserved(surfaceId)
      const revision = observedRevision ?? await view.snapshot(prefix(surfaceId), 'surface')
      if ((await this.workspace.revisions.read(revision)).kind !== 'surface') throw new WorkSurfaceError('invalid-working-copy', 'publication must name a Surface revision')
      const draft = this.draft(this.contracts.published, surfaceId, producerRef, operationKey, { ...metadata, expectedRevision: expected, revision }, [])
      if (current !== expected) throw new WorkSurfaceError('revision-conflict', `Surface '${surfaceId}' publication is stale`, { expected, actual: current })
      await this.workspace.revisions.pin(revision)
      return this.events.append(surfaceId, draft)
    })
  }

  recover(): Promise<void> { return this.workspace.transaction(view => this.recoverLocked(view)) }

  private async headLocked(view: LockedFileWorkspace, surfaceId: string): Promise<Revision> {
    const existing = await this.recordedHead(surfaceId)
    if (existing !== undefined) return existing
    const revision = await view.snapshot(prefix(surfaceId), 'surface')
    await this.events.append(surfaceId, this.draft(this.contracts.admitted, surfaceId, `surface-admission/${surfaceId}`, 'initial-revision', { revision, source: 'authoring' }, []))
    return revision
  }

  private async recoverLocked(view: LockedFileWorkspace): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    for (const filename of (await readdir(this.stateRoot)).filter(name => name.endsWith('.json')).sort()) {
      let intent: ApplyIntent
      try {
        const info = await lstat(join(this.stateRoot, filename))
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('intent must be a regular file')
        intent = JSON.parse(await readFile(join(this.stateRoot, filename), 'utf8')) as ApplyIntent
      }
      catch { throw new WorkSurfaceError('canonical-corrupt', 'Surface apply intent is unreadable') }
      this.validateIntent(intent, filename)
      await this.finishApply(view, intent)
    }
  }

  private async finishApply(view: LockedFileWorkspace, intent: ApplyIntent): Promise<void> {
    const existing = (await this.events.replay(intent.surfaceId)).find(event => event.id === intent.draft.id)
    if (existing === undefined) {
      const current = await this.recordedHead(intent.surfaceId)
      if (current !== intent.base) throw new WorkSurfaceError('revision-conflict', 'pending Surface apply no longer has its expected head')
      await this.assertUnreserved(intent.surfaceId, { registrationId: intent.draft.payload.registrationId as string, runId: intent.draft.payload.runId as string })
      if (intent.candidate !== intent.base) await this.workspaceChange(intent.surfaceId, intent.base, intent.candidate, () => view.replace(prefix(intent.surfaceId), intent.base, intent.candidate, intent.draft.id))
    }
    await this.events.append(intent.surfaceId, intent.draft)
    await unlink(this.intentPath(intent.draft.id))
    await syncDirectory(this.stateRoot)
  }

  private validateIntent(intent: ApplyIntent, filename: string): void {
    try {
      if (intent === null || typeof intent !== 'object' || Array.isArray(intent) || stableStringify(Object.keys(intent).sort()) !== stableStringify(['base', 'candidate', 'draft', 'surfaceId', 'version']) || intent.version !== 1 || !/^sha256:[0-9a-f]{64}$/.test(intent.base) || !/^sha256:[0-9a-f]{64}$/.test(intent.candidate)) throw new Error('invalid shape')
      validateId(intent.surfaceId)
      const draft = intent.draft
      if (draft === null || typeof draft !== 'object' || stableStringify(Object.keys(draft).sort()) !== stableStringify(['causes', 'id', 'operationKey', 'payload', 'producer', 'type'])) throw new Error('invalid draft')
      validateRuntimeEventEnvelope({ ...draft, version: 1, subject: { authority: this.events.authority, kind: 'surface', id: intent.surfaceId }, seq: 0, recordedAt: new Date().toISOString() })
      validatePayload(this.contracts.applied, draft.payload)
      if (!this.matches(draft, this.contracts.applied) || draft.payload.revision !== intent.candidate || draft.payload.baseRevision !== intent.base || draft.producer.kind !== 'runtime' || draft.producer.ref !== `${draft.payload.registrationId}/${draft.payload.runId}` || draft.operationKey !== `apply-${intent.surfaceId}` || draft.id !== runtimeEventId(this.events.authority, draft.producer.ref, draft.operationKey, intent.surfaceId) || this.intentPath(draft.id) !== join(this.stateRoot, filename)) throw new Error('identity mismatch')
    } catch { throw new WorkSurfaceError('canonical-corrupt', 'Surface apply intent is invalid') }
  }

  private async assertUnreserved(surfaceId: string, owner?: { readonly registrationId: string; readonly runId: string }): Promise<void> {
    for (const pending of await this.operations.pending()) if (Object.values(pending.surfaces).some(surface => surface.surfaceId === surfaceId) && (owner === undefined || pending.registrationId !== owner.registrationId || pending.runId !== owner.runId)) throw new WorkSurfaceError('revision-conflict', `Surface '${surfaceId}' is reserved by an incomplete Operation`, { registrationId: pending.registrationId, runId: pending.runId })
  }

  /** Keep the file core generic while retaining Surface context in durable failure messages. */
  private async workspaceChange(surfaceId: string, base: Revision, candidate: Revision, change: () => Promise<void>): Promise<void> {
    try { await change() }
    catch (error) {
      if (!(error instanceof WorkSurfaceError) || error.code !== 'revision-conflict') throw error
      const directory = join(this.workspace.root, prefix(surfaceId))
      const actual = typeof error.details.actual === 'string' ? `, authoring ${error.details.actual}` : ''
      throw new WorkSurfaceError(error.code,
        `Surface '${surfaceId}' at '${directory}': ${error.message} (base ${base}, candidate ${candidate}${actual}). Resolve this Surface's unpublished draft before retrying.`,
        { ...error.details, surfaceId, directory, baseRevision: base, candidateRevision: candidate })
    }
  }

  private draft(contract: RuntimeEventContract, surfaceId: string, producerRef: string, key: string, payload: Readonly<Record<string, JsonValue>>, causes: readonly RuntimeEventRef[]): RuntimeEventDraft {
    validatePayload(contract, payload)
    return { id: runtimeEventId(this.events.authority, producerRef, key, surfaceId), type: { scope: contract.scope, name: contract.name, contract: eventContractDigest(contract) }, payload, causes, producer: { kind: 'runtime', ref: producerRef }, operationKey: key }
  }
  private matches(event: Pick<RuntimeEventEnvelope, 'type'>, contract: RuntimeEventContract): boolean { return event.type.name === contract.name && event.type.contract === eventContractDigest(contract) && stableStringify(event.type.scope) === stableStringify(contract.scope) }
  private intentPath(id: string): string { return join(this.stateRoot, `${sha256(id)}.json`) }
}

function validateId(id: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new WorkSurfaceError('invalid-id', 'invalid Surface id') }
function prefix(id: string): string { validateId(id); return `surfaces/${id}` }
