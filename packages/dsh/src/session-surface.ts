import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session as DshSession, SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  FileEventStore,
  RevisionStore,
  WorkSurfaceError,
  publicationEventId,
  registrationSubject,
  sha256,
  stableStringify,
  surfaceTurnRuntimeBinding,
  surfaceSubject,
  type EventDraft,
  type EventRef,
  type JsonValue,
  type Revision,
  type RevisionGcResult,
  type WorkSurfaceEvent,
  type AuthorityId,
  type ContractDigest,
  type RuntimeBinding,
  type RuntimeScope,
} from '@pf-worksurface/core'
import type { WorkSurfaceEventPort } from '@pf-worksurface/runtime'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The one immutable WorkSurface identity whose progress this DSH Session records. */
    'worksurface/binding': SurfaceSessionBinding
  }
}

// Read compatibility for Sessions created by WorkSurface releases that wrote
// an informational binding fact. New bindings use only binding.json.
;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('worksurface/binding')

export type SurfaceInputSource = 'published' | 'authoring' | `revision:${string}`

/** Durable one-to-one execution identity, created before the Session starts. */
export interface SurfaceSessionBinding {
  readonly version: 1
  readonly surfaceId: string
  readonly sessionId: string
  readonly inputSource: 'published' | 'authoring' | 'revision'
  readonly inputRevision: Revision
  readonly expectedHead: Revision | null
}

interface SurfaceRevisionState {
  readonly inputSource: SurfaceSessionBinding['inputSource']
  readonly inputRevision: Revision
  readonly expectedHead: Revision | null
  readonly outputRevision?: Revision
}

export interface SurfaceSessionContext {
  readonly version: 1
  readonly execution: { readonly sessionId: string }
  readonly surface: {
    readonly id: string
    readonly inputSource: SurfaceRevisionState['inputSource']
    readonly inputRevision: Revision
    readonly expectedHead: Revision | null
    readonly outputRevision?: Revision
  }
  readonly capabilities: {
    readonly emit: readonly ['surface.revision.published', '*']
    readonly targetSurfaces: readonly [string]
  }
}

export interface SurfacePlanningSource {
  readonly surfaceId: string
  readonly sessionId: string
  readonly turn: number
}

export interface BoundSurfaceSession {
  readonly capability: string
  readonly sessionId: string
  readonly turn: number
  readonly surfaceId: string
  readonly cwd: string
  readonly contextFile: string
  readonly viewDir: string
  readonly runtimeBinding?: RuntimeBinding
  readonly binding: SurfaceSessionBinding
  readonly revision: SurfaceRevisionState
}

export interface SurfaceSessionGcResult {
  readonly retainedSurfaceSessions: number
  readonly sweptTemporaryPaths: number
}

interface TurnScope {
  readonly session: Session
  readonly turn: number
  readonly capability: string
  current: BoundSurfaceSession
}

export interface SurfaceTurnBriefOutput {
  readonly name: string
  readonly description: string
  readonly payloadSchema: Readonly<Record<string, JsonValue>>
  readonly scope?: RuntimeScope
  readonly digest?: ContractDigest
}
export interface SurfaceTurnBriefDraft {
  readonly instruction: string
  readonly inputs?: readonly { readonly label: string; readonly summary: string }[]
  readonly outputs: readonly SurfaceTurnBriefOutput[]
}

const RESERVED_EVENTS = new Set(['surface.revision.published', 'surface.publish.conflicted', 'surface.session.bound'])

/**
 * Makes one Surface's progress identical to one durable DSH Session.
 * It owns no second agent, retry, wait, cancellation, or completion lifecycle.
 */
export class SurfaceSessionService implements WorkSurfaceEventPort {
  private readonly capabilities = new Map<string, TurnScope>()
  private readonly currentBySession = new Map<string, TurnScope>()
  private readonly bindingsBySurface = new Map<string, SurfaceSessionBinding>()
  private readonly bindingsBySession = new Map<string, SurfaceSessionBinding>()
  private readonly revisionsBySurface = new Map<string, SurfaceRevisionState>()
  private readonly surfaceMutations = new Map<string, Promise<void>>()
  private bindingMutation: Promise<void> = Promise.resolve()
  private initialized = false
  private turnTransport: string
  private runtimeAuthority?: AuthorityId
  private readonly pendingBriefs = new Map<string, SurfaceTurnBriefDraft>()
  // A fast continuation can open its next DSH Turn before the async adapter
  // refresh after turn/end has completed. Retain the last prepared brief as a
  // conservative fallback; a later refresh replaces it, while Runtime still
  // authorizes the actual emit against the current Turn binding.
  private readonly lastBriefs = new Map<string, SurfaceTurnBriefDraft>()
  private followupRouter: ((surfaceId: string, message: string, messageId: string) => Promise<{ readonly sessionId: string; readonly messageId: string; readonly turnId: string }>) | undefined

  constructor(
    readonly eventStore: FileEventStore,
    readonly revisions: RevisionStore,
    readonly workRoot: string,
    readonly stateRoot: string,
  ) { this.turnTransport = join(stateRoot, 'run', 'host.sock') }

  /** Load the durable one-to-one index and rebuild any missing authoring directory. */
  async init(): Promise<void> {
    if (this.initialized) return
    const root = this.surfaceSessionsRoot()
    await mkdir(root, { recursive: true, mode: 0o700 })
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const binding = parseBinding(await readFile(join(root, entry.name, 'binding.json'), 'utf8'))
      if (entry.name !== binding.surfaceId) throw new WorkSurfaceError('invalid-working-copy', `Surface Session directory '${entry.name}' does not match binding '${binding.surfaceId}'`)
      this.indexBinding(binding)
    }
    for (const binding of this.bindingsBySurface.values()) {
      const revision = await this.deriveRevisionState(binding)
      this.revisionsBySurface.set(binding.surfaceId, revision)
      await this.revisions.pin(revision.inputRevision)
      if (revision.outputRevision !== undefined) await this.revisions.pin(revision.outputRevision)
      await this.ensureAuthoring(binding, revision)
      await atomicJson(this.contextPath(binding.surfaceId), contextFor(binding, revision))
    }
    this.initialized = true
  }

  registerFollowupRouter(router: NonNullable<SurfaceSessionService['followupRouter']>): () => void {
    if (this.followupRouter !== undefined) throw new WorkSurfaceError('already-exists', 'a DSH Session followup router is already registered')
    this.followupRouter = router
    return () => { if (this.followupRouter === router) this.followupRouter = undefined }
  }

  registerTurnTransport(socketPath: string): void { this.turnTransport = socketPath }
  registerRuntimeAuthority(authority: AuthorityId): void { this.runtimeAuthority = authority }
  prepareTurnBrief(surfaceId: string, brief: SurfaceTurnBriefDraft): void {
    validateSurfaceId(surfaceId)
    const snapshot = structuredClone(brief)
    this.pendingBriefs.set(surfaceId, snapshot)
    this.lastBriefs.set(surfaceId, snapshot)
  }

  followupSurface(surfaceId: string, message: string, messageId: string): Promise<{ readonly sessionId: string; readonly messageId: string; readonly turnId: string }> {
    if (this.followupRouter === undefined) throw new WorkSurfaceError('effect-failed', 'DSH Session followup routing is unavailable')
    return this.followupRouter(surfaceId, message, messageId)
  }

  /**
   * Bind during DSH Agent creation setup, before its first Turn.
   * Repeating the exact binding is recovery; either identity changing is rejected.
   */
  async bindSession(session: Session, surfaceId: string, source: SurfaceInputSource = 'published'): Promise<SurfaceSessionBinding> {
    validateSurfaceId(surfaceId)
    validateSource(source)
    if (!this.initialized) throw new WorkSurfaceError('effect-failed', 'Surface Session service is not initialized')
    const sessionId = String(session.id)
    const operation = this.bindingMutation.then(async () => {
      const existingForSurface = this.bindingsBySurface.get(surfaceId)
      const existingForSession = this.bindingsBySession.get(sessionId)
      if (existingForSurface !== undefined || existingForSession !== undefined) {
        const existing = existingForSurface ?? existingForSession!
        if (existing.surfaceId !== surfaceId || existing.sessionId !== sessionId) {
          throw new WorkSurfaceError('already-exists-conflict', existingForSurface !== undefined
            ? `Surface '${surfaceId}' already progresses as DSH Session '${existingForSurface.sessionId}'`
            : `DSH Session '${sessionId}' already progresses Surface '${existingForSession!.surfaceId}'`)
        }
        const cwd = session.header.cwd === undefined ? undefined : resolve(session.header.cwd)
        if (cwd !== resolve(this.workRoot) && cwd !== resolve(this.legacyWorktreePath(surfaceId))) {
          throw new WorkSurfaceError('already-exists-conflict', `DSH Session '${sessionId}' cwd does not match its WorkSurface binding`)
        }
        const revision = await this.deriveRevisionState(existing)
        this.revisionsBySurface.set(surfaceId, revision)
        await this.ensureAuthoring(existing, revision)
        await atomicJson(this.contextPath(surfaceId), contextFor(existing, revision))
        this.attachSession(session)
        return existing
      }

      if (session.header.cwd === undefined || resolve(session.header.cwd) !== resolve(this.workRoot)) {
        throw new WorkSurfaceError('already-exists-conflict', `DSH Session '${sessionId}' cwd must be the WorkSurface authoring root '${this.workRoot}'`)
      }
      if (session.events.some(event => event.type === 'turn/start')) {
        throw new WorkSurfaceError('already-exists-conflict', `DSH Session '${sessionId}' must bind its Surface before the first Turn`)
      }

      const binding = await this.createBinding(surfaceId, sessionId, source)
      const directory = this.surfaceSessionPath(surfaceId)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        await writeFile(join(directory, 'binding.json'), `${stableStringify(binding)}\n`, { flag: 'wx', mode: 0o400 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const raced = parseBinding(await readFile(join(directory, 'binding.json'), 'utf8'))
        if (raced.sessionId !== sessionId) throw new WorkSurfaceError('already-exists-conflict', `Surface '${surfaceId}' already progresses as DSH Session '${raced.sessionId}'`)
      }
      this.indexBinding(binding)
      const revision = await this.deriveRevisionState(binding)
      this.revisionsBySurface.set(surfaceId, revision)
      await this.revisions.pin(revision.inputRevision)
      await this.ensureAuthoring(binding, revision)
      await atomicJson(this.contextPath(surfaceId), contextFor(binding, revision))
      this.attachSession(session)
      return binding
    })
    this.bindingMutation = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Reconcile the Session log with its durable binding. Unbound Sessions are ignored. */
  attachSession(session: Session): SurfaceSessionBinding | undefined {
    const binding = this.bindingsBySession.get(String(session.id))
    if (binding === undefined) return undefined
    const recorded = bindingEvents(session)
    if (recorded.some(candidate => !sameBinding(candidate, binding)) || recorded.length > 1) {
      throw new WorkSurfaceError('already-exists-conflict', `DSH Session '${session.id}' contains more than one WorkSurface binding`)
    }
    // binding.json is the only durable identity fact. Older releases also
    // wrote an informational worksurface/binding event; reconcile it when
    // present, but never create another plugin-private fact in the DSH log.
    // A Host can persist through a different @deepseek-ai/dsh-session copy and
    // strip an extension envelope that the live Session object preserved.
    return binding
  }

  beginTurn(session: Session, turn: number): string | undefined {
    const binding = this.attachSession(session)
    if (binding === undefined) return undefined
    if (!Number.isSafeInteger(turn) || turn < 0) throw new WorkSurfaceError('invalid-working-copy', 'Turn must be a non-negative safe integer')
    const boundary = session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (boundary?.type !== 'turn/start' || boundary.data.turn !== turn) throw new WorkSurfaceError('unauthorized', 'WorkSurface capability requires the currently open DSH Turn')
    const sessionId = String(session.id)
    this.endTurn(sessionId)
    const revision = this.revisionsBySurface.get(binding.surfaceId)
    if (revision === undefined) throw new WorkSurfaceError('effect-failed', `Surface Session '${binding.surfaceId}' has no recovered revision state`)
    const capability = randomUUID()
    const view = this.createTurnView(binding.surfaceId, sessionId, turn, capability)
    const current: BoundSurfaceSession = {
      capability,
      sessionId,
      turn,
      surfaceId: binding.surfaceId,
      cwd: resolve(session.header.cwd ?? '') === resolve(this.legacyWorktreePath(binding.surfaceId))
        ? this.legacyWorktreePath(binding.surfaceId)
        : this.authoringPath(binding.surfaceId),
      contextFile: this.contextPath(binding.surfaceId),
      viewDir: view.viewDir,
      ...(view.runtimeBinding === undefined ? {} : { runtimeBinding: view.runtimeBinding }),
      binding,
      revision,
    }
    const scope: TurnScope = { session, turn, capability, current }
    this.capabilities.set(capability, scope)
    this.currentBySession.set(sessionId, scope)
    return capability
  }

  private createTurnView(surfaceId: string, sessionId: string, turn: number, capability: string): { readonly viewDir: string; readonly runtimeBinding?: RuntimeBinding } {
    const viewDir = join(this.stateRoot, 'runtime', 'turn-views', sessionId, String(turn))
    mkdirSync(join(viewDir, 'contracts'), { recursive: true, mode: 0o700 })
    const draft = this.pendingBriefs.get(surfaceId) ?? this.lastBriefs.get(surfaceId) ?? { instruction: 'Continue the current Surface objective using its files and acceptance criteria.', outputs: [] }
    this.pendingBriefs.delete(surfaceId)
    const outputs = draft.outputs.map(output => {
      const schemaFile = `contracts/${output.name}.payload.schema.json`
      writeFileSync(join(viewDir, schemaFile), `${stableStringify(output.payloadSchema)}\n`, { flag: 'w', mode: 0o400 })
      return {
        name: output.name,
        when: `Emit only when ${output.description}`,
        payloadSummary: output.description,
        schemaPath: `$DSH_WORKSURFACE_VIEW_DIR/${schemaFile}`,
        command: { argv: ['$DSH_WORKSURFACE_CLI', 'emit', output.name, '--payload', '<JSON matching schema>'] },
      }
    })
    const brief = {
      version: 1,
      surface: { handle: '$DSH_SURFACE_ID', directory: '$DSH_SURFACE_DIR', entryPaths: ['surface.md'] },
      runtimeView: '$DSH_WORKSURFACE_VIEW_DIR',
      instruction: draft.instruction,
      inputs: draft.inputs ?? [],
      outputs,
    }
    writeFileSync(join(viewDir, 'turn-brief.json'), `${stableStringify(brief)}\n`, { flag: 'w', mode: 0o400 })
    writeFileSync(join(viewDir, '.runtime.json'), `${stableStringify({ version: 1, socketPath: this.turnTransport, capability })}\n`, { flag: 'w', mode: 0o400 })
    const resolved = Object.fromEntries(draft.outputs.flatMap(output => output.scope === undefined || output.digest === undefined ? [] : [[output.name, { scope: output.scope, digest: output.digest }]]))
    const runtimeBinding = this.runtimeAuthority === undefined ? undefined : surfaceTurnRuntimeBinding(this.runtimeAuthority, { surfaceId, executionId: sessionId, turnId: String(turn) }, resolved)
    return { viewDir, ...(runtimeBinding === undefined ? {} : { runtimeBinding }) }
  }

  endTurn(sessionId: string, turn?: number): void {
    const scope = this.currentBySession.get(sessionId)
    if (scope === undefined || (turn !== undefined && scope.turn !== turn)) return
    this.capabilities.delete(scope.capability)
    this.currentBySession.delete(sessionId)
  }

  activeSurface(sessionId: string): BoundSurfaceSession | undefined {
    return this.currentBySession.get(sessionId)?.current
  }

  activeTurn(sessionId: string): { readonly turn: number; readonly capability: string } | undefined {
    const scope = this.currentBySession.get(sessionId)
    return scope === undefined ? undefined : { turn: scope.turn, capability: scope.capability }
  }

  planningSource(capability: string): SurfacePlanningSource {
    const current = this.requireScope(capability).current
    return { surfaceId: current.surfaceId, sessionId: current.sessionId, turn: current.turn }
  }

  bindingForSurface(surfaceId: string): SurfaceSessionBinding | undefined { return this.bindingsBySurface.get(surfaceId) }
  bindingForSession(sessionId: string): SurfaceSessionBinding | undefined { return this.bindingsBySession.get(sessionId) }
  /** Enumerate the one-to-one bindings that startup recovery may inspect. */
  listBindings(): readonly SurfaceSessionBinding[] {
    return [...this.bindingsBySurface.values()]
      .map(binding => structuredClone(binding))
      .sort((left, right) => left.surfaceId.localeCompare(right.surfaceId))
  }
  cwdForSurface(surfaceId: string): string {
    validateSurfaceId(surfaceId)
    return this.workRoot
  }

  /** Make a code-first committed Revision the fact-backed input of later Turns without writing a v4 publication Event. */
  async adoptRuntimeRevision(surfaceId: string, revision: Revision): Promise<void> {
    validateSurfaceId(surfaceId)
    if ((await this.revisions.read(revision)).kind !== 'surface') throw new WorkSurfaceError('canonical-corrupt', `Runtime Revision '${revision}' is not a Surface Revision`)
    const current = this.revisionsBySurface.get(surfaceId)
    const binding = this.bindingsBySurface.get(surfaceId)
    if (current === undefined || binding === undefined) return
    const adopted: SurfaceRevisionState = { inputSource: 'published', inputRevision: revision, expectedHead: current.expectedHead, outputRevision: revision }
    this.revisionsBySurface.set(surfaceId, adopted)
    const scope = this.currentBySession.get(binding.sessionId)
    if (scope !== undefined) scope.current = { ...scope.current, revision: adopted }
    await this.revisions.pin(revision)
    await atomicJson(this.contextPath(surfaceId), contextFor(binding, adopted))
  }

  /** Resolve the product default for an unbound Surface without asking the user for protocol vocabulary. */
  async defaultInputSource(surfaceId: string): Promise<SurfaceInputSource> {
    validateSurfaceId(surfaceId)
    await this.assertSurfaceRoot()
    if (await exists(this.authoringPath(surfaceId))) return 'authoring'
    if (publishedHead(await this.replaySurface(surfaceId)) !== null) return 'published'
    throw new WorkSurfaceError('not-found', `Surface '${surfaceId}' has neither an authoring directory nor a published revision`)
  }

  async emitTurn(capability: string, name: string, payload: JsonValue, operationKey?: string): Promise<EventRef> {
    const scope = this.requireScope(capability)
    const current = scope.current
    if (name === 'surface.publish.conflicted' || name === 'surface.session.bound') throw new WorkSurfaceError('unauthorized', `'${name}' is emitted only by the WorkSurface Host`)
    if (name === 'surface.revision.published') return this.publish(scope, payload)
    const key = operationKey ?? name
    return this.eventStore.append(surfaceSubject(current.surfaceId), {
      id: `evt_${sha256(`${current.sessionId}\0${current.turn}\0${current.surfaceId}\0${key}`).slice(0, 40)}`,
      name,
      payload,
      meta: { sessionId: current.sessionId, turn: current.turn, operationKey: key },
    })
  }

  async appendSurface(surfaceId: string, draft: EventDraft): Promise<EventRef> {
    validateSurfaceId(surfaceId)
    if (RESERVED_EVENTS.has(draft.name)) throw new WorkSurfaceError('unauthorized', `'${draft.name}' requires the Surface's live DSH Session`)
    return this.eventStore.append(surfaceSubject(surfaceId), draft)
  }

  replaySurface(surfaceId: string, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]> {
    validateSurfaceId(surfaceId)
    return this.eventStore.replay(surfaceSubject(surfaceId), fromSeq)
  }

  appendRegistration(registrationId: string, draft: EventDraft): Promise<EventRef> {
    return this.eventStore.append(registrationSubject(registrationId), draft)
  }

  replayRegistration(registrationId: string, fromSeq?: number): Promise<readonly WorkSurfaceEvent[]> {
    return this.eventStore.replay(registrationSubject(registrationId), fromSeq)
  }

  /** Repair authoring projections and contexts. DSH repairs and resumes Sessions. */
  async recover(): Promise<void> {
    for (const binding of this.bindingsBySurface.values()) {
      const revision = await this.deriveRevisionState(binding)
      this.revisionsBySurface.set(binding.surfaceId, revision)
      await this.ensureAuthoring(binding, revision)
      await atomicJson(this.contextPath(binding.surfaceId), contextFor(binding, revision))
    }
  }

  async collectGarbage(minAgeMs = 7 * 24 * 60 * 60 * 1_000): Promise<RevisionGcResult> {
    const reachable = new Set<Revision>()
    for (const binding of this.bindingsBySurface.values()) {
      reachable.add(binding.inputRevision)
      const state = this.revisionsBySurface.get(binding.surfaceId)
      if (state?.outputRevision !== undefined) reachable.add(state.outputRevision)
    }
    for (const kind of ['surface', 'registration'] as const) {
      for (const id of await this.eventStore.list(kind)) {
        const events = await this.eventStore.replay(kind === 'surface' ? surfaceSubject(id) : registrationSubject(id))
        for (const event of events) collectRevisionReferences(event, reachable)
      }
    }
    return this.revisions.collect({ reachable, minAgeMs })
  }

  /** Authoring WIP is durable; collect only abandoned Surface Session temporaries. */
  async collectSessionGarbage(minAgeMs = 7 * 24 * 60 * 60 * 1_000): Promise<SurfaceSessionGcResult> {
    if (!Number.isFinite(minAgeMs) || minAgeMs < 0) throw new WorkSurfaceError('invalid-working-copy', 'Surface Session GC requires a non-negative finite age')
    const root = this.surfaceSessionsRoot()
    await mkdir(root, { recursive: true, mode: 0o700 })
    let sweptTemporaryPaths = 0
    const cutoff = Date.now() - minAgeMs
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.name.endsWith('.tmp')) {
          const info = await lstat(path)
          if (info.mtimeMs <= cutoff) { await rm(path, { recursive: true, force: true }); sweptTemporaryPaths += 1 }
        } else if (entry.isDirectory()) await walk(path)
      }
    }
    await walk(root)
    return { retainedSurfaceSessions: this.bindingsBySurface.size, sweptTemporaryPaths }
  }

  /** @deprecated Use collectSessionGarbage. */
  collectWorktreeGarbage(minAgeMs?: number): Promise<SurfaceSessionGcResult> {
    return this.collectSessionGarbage(minAgeMs)
  }

  private async createBinding(surfaceId: string, sessionId: string, source: SurfaceInputSource): Promise<SurfaceSessionBinding> {
    let prepared: Revision | undefined
    let inputSource: SurfaceSessionBinding['inputSource']
    if (source === 'authoring') {
      await this.assertSurfaceRoot()
      prepared = (await this.revisions.snapshotSurface(this.authoringPath(surfaceId))).revision
      inputSource = 'authoring'
    } else if (source.startsWith('revision:')) {
      prepared = source.slice('revision:'.length) as Revision
      if ((await this.revisions.read(prepared)).kind !== 'surface') throw new WorkSurfaceError('invalid-working-copy', `revision '${prepared}' is not a Surface revision`)
      inputSource = 'revision'
    } else {
      inputSource = 'published'
    }
    const head = publishedHead(await this.replaySurface(surfaceId))
    if (source === 'published' && head === null) throw new WorkSurfaceError('not-found', `Surface '${surfaceId}' has no published head; bind it from authoring or an exact revision`)
    return {
      version: 1,
      surfaceId,
      sessionId,
      inputSource,
      inputRevision: source === 'published' ? head! : prepared!,
      expectedHead: head,
    }
  }

  private async deriveRevisionState(binding: SurfaceSessionBinding): Promise<SurfaceRevisionState> {
    const events = await this.replaySurface(binding.surfaceId)
    const latest = events.findLast(event => event.name === 'surface.revision.published'
      && event.meta.sessionId === binding.sessionId
      && event.meta.outputRevision !== undefined)
    return latest === undefined
      ? { inputSource: binding.inputSource, inputRevision: binding.inputRevision, expectedHead: binding.expectedHead }
      : { inputSource: 'published', inputRevision: latest.meta.outputRevision!, expectedHead: latest.meta.outputRevision!, outputRevision: latest.meta.outputRevision! }
  }

  private async publish(scope: TurnScope, payload: JsonValue): Promise<EventRef> {
    const current = scope.current
    return this.serializeSurface(current.surfaceId, async () => {
      if (current.cwd === this.authoringPath(current.surfaceId)) await this.assertSurfaceRoot()
      const outputRevision = (await this.revisions.snapshotSurface(current.cwd)).revision
      await this.revisions.pin(outputRevision)
      const expectedHead = current.revision.expectedHead
      let published = false
      const ref = await this.eventStore.appendWith(surfaceSubject(current.surfaceId), events => {
        const name = publishedHead(events) === expectedHead ? 'surface.revision.published' : 'surface.publish.conflicted'
        published = name === 'surface.revision.published'
        return {
          id: publicationEventId(current.sessionId, current.turn, current.surfaceId, outputRevision),
          name,
          payload,
          meta: {
            sessionId: current.sessionId,
            turn: current.turn,
            inputSource: current.revision.inputSource,
            inputRevision: current.revision.inputRevision,
            expectedHead,
            outputRevision,
          },
        }
      })
      if (published) {
        const revision: SurfaceRevisionState = {
          inputSource: 'published',
          inputRevision: outputRevision,
          expectedHead: outputRevision,
          outputRevision,
        }
        this.revisionsBySurface.set(current.surfaceId, revision)
        scope.current = { ...current, revision }
        await atomicJson(current.contextFile, contextFor(current.binding, revision))
      }
      return ref
    })
  }

  private async ensureAuthoring(binding: SurfaceSessionBinding, revision: SurfaceRevisionState): Promise<string> {
    const root = this.surfaceSessionPath(binding.surfaceId)
    const authoring = this.authoringPath(binding.surfaceId)
    const marker = join(root, 'authoring.initialized')
    const legacyMarker = join(root, 'work.initialized')
    const legacyWorktree = this.legacyWorktreePath(binding.surfaceId)
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (await exists(legacyMarker)) {
      if (await exists(legacyWorktree)) {
        await requireRealDirectory(legacyWorktree, 'legacy Surface worktree')
        return legacyWorktree
      }
      const temporary = join(root, `work.${randomUUID()}.tmp`)
      try {
        await this.revisions.materialize(revision.inputRevision, temporary)
        await rename(temporary, legacyWorktree)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
      return legacyWorktree
    }

    await this.assertSurfaceRoot()
    if (await exists(authoring)) {
      await requireRealDirectory(authoring, 'Surface authoring path')
      await writeMarker(marker, revision.inputRevision)
      return authoring
    }

    const temporary = join(root, `authoring.${randomUUID()}.tmp`)
    try {
      await this.revisions.materialize(revision.inputRevision, temporary)
      await rename(temporary, authoring)
      await writeMarker(marker, revision.inputRevision)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
    return authoring
  }

  private requireScope(capability: string): TurnScope {
    const scope = this.capabilities.get(capability)
    if (scope === undefined || this.currentBySession.get(String(scope.session.id)) !== scope) {
      throw new WorkSurfaceError('unauthorized', 'DSH Surface Session/Turn capability is missing, expired, or superseded')
    }
    return scope
  }

  private indexBinding(binding: SurfaceSessionBinding): void {
    const bySurface = this.bindingsBySurface.get(binding.surfaceId)
    const bySession = this.bindingsBySession.get(binding.sessionId)
    if (bySurface !== undefined && !sameBinding(bySurface, binding)) throw new WorkSurfaceError('already-exists-conflict', `Surface '${binding.surfaceId}' has conflicting DSH Session bindings`)
    if (bySession !== undefined && !sameBinding(bySession, binding)) throw new WorkSurfaceError('already-exists-conflict', `DSH Session '${binding.sessionId}' has conflicting Surface bindings`)
    this.bindingsBySurface.set(binding.surfaceId, binding)
    this.bindingsBySession.set(binding.sessionId, binding)
  }

  private async assertSurfaceRoot(): Promise<void> {
    await requireRealDirectory(resolve(this.workRoot, 'surfaces'), 'Surface authoring root')
  }

  private authoringPath(surfaceId: string): string {
    const root = resolve(this.workRoot, 'surfaces')
    const path = resolve(root, surfaceId)
    if (!path.startsWith(`${root}${sep}`)) throw new WorkSurfaceError('unauthorized', 'Surface authoring path escapes surfaces root')
    return path
  }

  private surfaceSessionsRoot(): string { return resolve(this.stateRoot, 'surface-sessions') }

  private surfaceSessionPath(surfaceId: string): string {
    validateSurfaceId(surfaceId)
    return join(this.surfaceSessionsRoot(), surfaceId)
  }

  private legacyWorktreePath(surfaceId: string): string { return join(this.surfaceSessionPath(surfaceId), 'work') }
  private contextPath(surfaceId: string): string { return join(this.surfaceSessionPath(surfaceId), 'context.json') }

  private serializeSurface<T>(surfaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.surfaceMutations.get(surfaceId) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.surfaceMutations.set(surfaceId, settled)
    void settled.finally(() => { if (this.surfaceMutations.get(surfaceId) === settled) this.surfaceMutations.delete(surfaceId) })
    return result
  }
}

function bindingEvents(session: Session): SurfaceSessionBinding[] {
  return session.events.flatMap(event => event.type === 'worksurface/binding' ? [event.data as SurfaceSessionBinding] : [])
}

/**
 * Extension facts require both a Session implementation that retains the
 * `ignorable` envelope and the matching persistence generation. The latter
 * introduced borrowed Session sources and explicit empty materialization in
 * the same compatibility generation. Testing both sides avoids a false
 * positive when a linked plugin and Host resolve different package copies.
 */
export function supportsPersistedIgnorableSessionEvents(
  session: Session,
  binding: SurfaceSessionBinding,
  persistence: {
    readonly borrowSession?: unknown
    readonly ensureMaterialized?: unknown
  },
): boolean {
  if (typeof persistence.borrowSession !== 'function' || typeof persistence.ensureMaterialized !== 'function') return false
  const id = SessionId(`worksurface-compat-${randomUUID()}`)
  const constructor = session.constructor as typeof DshSession
  const probe = constructor.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0 })
  return probe.append('worksurface/binding', binding, { ignorable: true }).ignorable === true
}

function contextFor(binding: SurfaceSessionBinding, revision: SurfaceRevisionState): SurfaceSessionContext {
  return {
    version: 1,
    execution: { sessionId: binding.sessionId },
    surface: {
      id: binding.surfaceId,
      inputSource: revision.inputSource,
      inputRevision: revision.inputRevision,
      expectedHead: revision.expectedHead,
      ...(revision.outputRevision === undefined ? {} : { outputRevision: revision.outputRevision }),
    },
    capabilities: { emit: ['surface.revision.published', '*'], targetSurfaces: [binding.surfaceId] },
  }
}

function parseBinding(text: string): SurfaceSessionBinding {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new WorkSurfaceError('invalid-working-copy', 'Surface Session binding is not valid JSON') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new WorkSurfaceError('invalid-working-copy', 'Surface Session binding must be an object')
  const binding = value as Record<string, unknown>
  if (binding.version !== 1 || typeof binding.surfaceId !== 'string' || typeof binding.sessionId !== 'string'
    || !['published', 'authoring', 'revision'].includes(String(binding.inputSource))
    || typeof binding.inputRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(binding.inputRevision)
    || !(binding.expectedHead === null || (typeof binding.expectedHead === 'string' && /^sha256:[0-9a-f]{64}$/.test(binding.expectedHead)))) {
    throw new WorkSurfaceError('invalid-working-copy', 'Surface Session binding has an invalid shape')
  }
  validateSurfaceId(binding.surfaceId)
  if (binding.sessionId === '') throw new WorkSurfaceError('invalid-working-copy', 'Surface Session binding has a blank Session id')
  return binding as unknown as SurfaceSessionBinding
}

function sameBinding(left: SurfaceSessionBinding, right: SurfaceSessionBinding): boolean {
  return stableStringify(left) === stableStringify(right)
}

function publishedHead(events: readonly WorkSurfaceEvent[]): Revision | null {
  return events.findLast(event => event.name === 'surface.revision.published' && event.meta.outputRevision !== undefined)?.meta.outputRevision ?? null
}

function validateSurfaceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new WorkSurfaceError('invalid-id', `invalid Surface id '${value}'`)
}

function validateSource(value: string): asserts value is SurfaceInputSource {
  if (!/^(published|authoring|revision:sha256:[0-9a-f]{64})$/.test(value)) throw new WorkSurfaceError('invalid-working-copy', 'input source must be published, authoring, or revision:<sha256 revision>')
}

function collectRevisionReferences(value: unknown, result: Set<Revision>): void {
  if (typeof value === 'string') { if (/^sha256:[0-9a-f]{64}$/.test(value)) result.add(value as Revision); return }
  if (Array.isArray(value)) { for (const child of value) collectRevisionReferences(child, result); return }
  if (value !== null && typeof value === 'object') for (const child of Object.values(value)) collectRevisionReferences(child, result)
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${stableStringify(value)}\n`, { flag: 'wx', mode: 0o400 })
  await rename(temporary, path)
}

async function requireRealDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WorkSurfaceError('invalid-working-copy', `${label} must be a real directory`)
  }
}

async function writeMarker(path: string, revision: Revision): Promise<void> {
  try { await writeFile(path, `${revision}\n`, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
