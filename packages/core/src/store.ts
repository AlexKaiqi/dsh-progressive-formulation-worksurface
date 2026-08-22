import { randomBytes } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { WorkSurfaceError } from './error.ts'
import { hashSurfaceContent, sha256, stableStringify } from './hash.ts'
import { BlockId, deriveSurfaceId, sessionSurfaceId, SurfaceId } from './ids.ts'
import { EffectJournal } from './journal.ts'
import { withRecoverableLock } from './lock.ts'
import { WorkSessionLog } from './work-session.ts'
import {
  instantiateBlockDocument,
  instantiateSurfaceDocument,
  parseBlockDocument,
  parseBlockReferences,
  parseSurfaceDocument,
} from './markdown.ts'
import type {
  BindSurfaceSessionOptions,
  BlockId as BlockIdType,
  BlockRef,
  CheckoutResult,
  CommitResult,
  FaultInjector,
  NewSurfaceResult,
  OrchestratorDefinition,
  Revision,
  SurfaceHead,
  SurfaceId as SurfaceIdType,
  SurfaceSnapshot,
  SurfaceSessionBinding,
  SurfaceSessionInput,
  WorkSurfaceDependencyEdge,
  WorkSurfaceGraphNode,
  WorkSurfaceGraphSnapshot,
  WorkSessionSnapshot,
} from './types.ts'

interface StoreOptions {
  readonly root: string
  readonly faultInjector?: FaultInjector
}

interface NewSurfaceOptions {
  readonly attemptId: string
  readonly key: string
  readonly templatePath: string
  readonly parent?: string | null
  readonly surface?: string
  readonly retry?: boolean
}

interface CheckoutOptions {
  readonly surface: string
  readonly targetPath: string
  readonly revision?: Revision
}

interface CommitOptions {
  readonly attemptId: string
  readonly key: string
  readonly workingPath: string
  readonly baseRevision: Revision
  readonly retry?: boolean
}

interface CommitRecord<T = unknown> {
  readonly commitId: string
  readonly surface: SurfaceIdType
  readonly revision: Revision
  readonly parentCommitId: string | null
  readonly effect: {
    readonly attemptId: string
    readonly key: string
    readonly type: string
    readonly requestHash: string
  }
  readonly result: T
  readonly createdAt: string
}

interface MutableSnapshot {
  readonly surfaceDocument: string
  readonly blocks: Map<BlockIdType, string>
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })
const REVISION_RE = /^sha256:[0-9a-f]{64}$/

/** File-backed canonical WorkSurface store with immutable revisions and optimistic commits. */
export class WorkSurfaceStore {
  /** Canonical immutable content root. */
  readonly canonicalRoot: string
  /** Runtime journals and coordination state root. */
  readonly runtimeRoot: string
  /** Surface-local append-only Work Sessions. */
  readonly sessions: WorkSessionLog
  private readonly journal: EffectJournal
  private readonly faultInjector: FaultInjector | undefined

  constructor(options: StoreOptions) {
    const root = resolve(options.root)
    this.canonicalRoot = join(root, 'canonical')
    this.runtimeRoot = join(root, 'runtime')
    this.sessions = new WorkSessionLog(join(this.canonicalRoot, 'surfaces'))
    this.faultInjector = options.faultInjector
    this.journal = new EffectJournal(join(this.runtimeRoot, 'effect-journal'), options.faultInjector)
  }

  /** Create required private roots. */
  async init(): Promise<void> {
    await mkdir(join(this.canonicalRoot, 'surfaces'), { recursive: true, mode: 0o700 })
    await mkdir(join(this.canonicalRoot, 'orchestrator', 'definitions'), { recursive: true, mode: 0o700 })
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 })
  }

  /**
   * Create one Surface from a reusable file template under an idempotency key.
   * @param options - Attempt identity, key, template, and optional assigned ids.
   * @returns The created or replayed Surface revision.
   */
  async newSurface(options: NewSurfaceOptions): Promise<NewSurfaceResult> {
    await this.init()
    const parent = options.parent === undefined || options.parent === null ? null : SurfaceId(options.parent)
    const surface = options.surface === undefined ? deriveSurfaceId(options.attemptId, options.key) : SurfaceId(options.surface)
    const template = await readWorkingTree(options.templatePath)
    const instantiated = instantiateTemplate(template, surface, parent)
    await this.validateSnapshot(surface, instantiated, parent)
    const revision = hashSurfaceContent(instantiated.surfaceDocument, instantiated.blocks)
    const request = { surface, parent, templateRevision: revision }
    const requestHash = effectRequestHash('new', request)
    const commitId = effectCommitId(options.attemptId, options.key, requestHash)
    return this.journal.run({
      attemptId: options.attemptId,
      key: options.key,
      type: 'new',
      request,
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      reconcile: async () => {
        const reconciled = await this.reconcileCommit<NewSurfaceResult>(surface, commitId)
        if (reconciled !== undefined) await this.ensureNewSurfaceFacts(surface, parent, commitId, options, reconciled)
        return reconciled
      },
      execute: async () => {
        const paths = this.paths(surface)
        await mkdir(paths.surfaceRoot, { recursive: true, mode: 0o700 })
        return withRecoverableLock(paths.lock, async () => {
          const head = await readJsonOptional<SurfaceHead>(paths.head)
          if (head) throw new WorkSurfaceError('already-exists', `Surface '${surface}' already exists`, { surface })
          await this.writeRevision(surface, revision, instantiated)
          const result: NewSurfaceResult = { surface, revision }
          const record = createCommitRecord(surface, revision, null, commitId, options, 'new', requestHash, result)
          await writeJsonAtomic(join(paths.commits, `${commitId}.json`), record)
          await this.ensureNewSurfaceFacts(surface, parent, commitId, options, result)
          await writeJsonAtomic(paths.head, { revision, commitId } satisfies SurfaceHead)
          await this.faultInjector?.('new-head-published')
          return result
        })
      },
    })
  }

  /**
   * Materialize one immutable revision into an editable directory.
   * @param options - Surface, optional revision, and empty target path.
   * @returns The checkout identity and absolute path.
   */
  async checkout(options: CheckoutOptions): Promise<CheckoutResult> {
    const surface = SurfaceId(options.surface)
    const target = resolve(options.targetPath)
    const existing = await readdirOptional(target)
    if (existing && existing.length > 0) {
      throw new WorkSurfaceError('target-not-empty', `checkout target is not empty: ${target}`, { target })
    }
    const snapshot = await this.readSnapshot(surface, options.revision)
    await mkdir(join(target, 'blocks'), { recursive: true, mode: 0o700 })
    await writeFile(join(target, 'surface.md'), snapshot.surfaceDocument, { mode: 0o600, flag: 'wx' })
    for (const [block, content] of snapshot.blocks) {
      await writeFile(join(target, 'blocks', `${block}.md`), content, { mode: 0o600, flag: 'wx' })
    }
    return { surface, revision: snapshot.revision, path: target }
  }

  /**
   * Validate and atomically publish one working copy against its base revision.
   * @param options - Attempt, effect key, working path, and exact base revision.
   * @returns The committed or replayed revision result.
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    assertRevision(options.baseRevision)
    await this.init()
    const working = await readWorkingTree(options.workingPath)
    const envelope = parseSurfaceDocument(working.surfaceDocument)
    const surface = envelope.surfaceId
    const candidateRevision = hashSurfaceContent(working.surfaceDocument, working.blocks)
    const request = { surface, baseRevision: options.baseRevision, candidateRevision }
    const requestHash = effectRequestHash('commit', request)
    const commitId = effectCommitId(options.attemptId, options.key, requestHash)
    return this.journal.run({
      attemptId: options.attemptId,
      key: options.key,
      type: 'commit',
      request,
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      reconcile: async () => {
        const reconciled = await this.reconcileCommit<CommitResult>(surface, commitId)
        if (reconciled !== undefined) await this.ensureCommitFact(surface, commitId, options, reconciled)
        return reconciled
      },
      execute: async () => {
        const paths = this.paths(surface)
        await mkdir(paths.surfaceRoot, { recursive: true, mode: 0o700 })
        return withRecoverableLock(paths.lock, async () => {
          const head = await this.readHeadUnlocked(surface)
          if (head.revision !== options.baseRevision) {
            throw new WorkSurfaceError('revision-conflict', `Surface '${surface}' changed after checkout`, {
              expected: options.baseRevision,
              actual: head.revision,
            })
          }
          const previous = await this.readSnapshot(surface, head.revision)
          const previousEnvelope = parseSurfaceDocument(previous.surfaceDocument)
          if (envelope.parent !== previousEnvelope.parent) {
            throw new WorkSurfaceError('unauthorized', 'Surface parent is runtime-owned and cannot be changed by a working copy')
          }
          for (const block of previous.blocks.keys()) {
            if (!working.blocks.has(block)) {
              throw new WorkSurfaceError('physical-delete-forbidden', `Block '${block}' cannot be physically deleted`, { block })
            }
          }
          await this.validateSnapshot(surface, working, previousEnvelope.parent)
          await this.writeRevision(surface, candidateRevision, working)
          const result: CommitResult = {
            surface,
            revision: candidateRevision,
            previousRevision: head.revision,
            noOp: candidateRevision === head.revision,
          }
          const record = createCommitRecord(surface, candidateRevision, head.commitId, commitId, options, 'commit', requestHash, result)
          await writeJsonAtomic(join(paths.commits, `${commitId}.json`), record)
          await this.ensureCommitFact(surface, commitId, options, result)
          await writeJsonAtomic(paths.head, { revision: candidateRevision, commitId } satisfies SurfaceHead)
          await this.faultInjector?.('commit-head-published')
          return result
        })
      },
    })
  }

  /**
   * Read the current or a pinned immutable Surface snapshot.
   * @param surfaceInput - Surface id to validate.
   * @param revisionInput - Optional immutable revision; defaults to HEAD.
   * @returns The verified canonical snapshot.
   */
  async readSnapshot(surfaceInput: string, revisionInput?: Revision): Promise<SurfaceSnapshot> {
    const surface = SurfaceId(surfaceInput)
    const revision = revisionInput ?? (await this.readHead(surface)).revision
    assertRevision(revision)
    const revisionRoot = join(this.paths(surface).revisions, revision.slice('sha256:'.length))
    let mutable: MutableSnapshot
    try {
      mutable = await readWorkingTree(revisionRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        throw new WorkSurfaceError('not-found', `revision '${revision}' does not exist for Surface '${surface}'`, { surface, revision })
      }
      throw error
    }
    const actual = hashSurfaceContent(mutable.surfaceDocument, mutable.blocks)
    if (actual !== revision) {
      throw new WorkSurfaceError('canonical-corrupt', `revision '${revision}' content hash does not match`, { actual, revision })
    }
    return { surface, revision, surfaceDocument: mutable.surfaceDocument, blocks: mutable.blocks }
  }

  /**
   * Resolve and validate one revision-pinned Block reference.
   * @param ref - Exact Surface, Block, and revision identity.
   * @returns The committed Block Markdown.
   */
  async readBlock(ref: BlockRef): Promise<string> {
    const snapshot = await this.readSnapshot(ref.surface, ref.revision)
    const block = snapshot.blocks.get(BlockId(ref.block))
    if (block === undefined) {
      throw new WorkSurfaceError('dangling-reference', `Block '${ref.surface}/${ref.block}' is absent at '${ref.revision}'`, { ref })
    }
    return block
  }

  /**
   * Ensure every returned child output names an existing committed Block at the exact revision.
   * @param refs - Structured child output references to validate.
   */
  async validateOutputRefs(refs: readonly BlockRef[]): Promise<void> {
    for (const ref of refs) await this.readBlock(ref)
  }

  /**
   * Read the current head pointer.
   * @param surfaceInput - Surface id to validate.
   * @returns The verified revision and commit pointer.
   */
  async readHead(surfaceInput: string): Promise<SurfaceHead> {
    const surface = SurfaceId(surfaceInput)
    const paths = this.paths(surface)
    try {
      await this.sessions.readHeader(surface)
    } catch (error) {
      if (error instanceof WorkSurfaceError && error.code === 'not-found'
        && await readJsonOptional<SurfaceHead>(paths.head) !== undefined) {
        throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has a materialized HEAD without a Work Session`)
      }
      throw error
    }
    return withRecoverableLock(paths.lock, async () => this.readHeadUnlocked(surface))
  }

  private async readHeadUnlocked(surface: SurfaceIdType): Promise<SurfaceHead> {
    let session: WorkSessionSnapshot
    try {
      session = await this.sessions.read(surface)
    } catch (error) {
      if (error instanceof WorkSurfaceError && error.code === 'not-found'
        && await readJsonOptional<SurfaceHead>(this.paths(surface).head) !== undefined) {
        throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has a materialized HEAD without a published Work Session`)
      }
      throw error
    }
    const canonicalHeads = foldSurfaceHeads(session)
    const canonical = canonicalHeads.at(-1)
    if (canonical === undefined) throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has no published revision`)
    const path = this.paths(surface).head
    const materialized = await readJsonOptional<SurfaceHead>(path)
    if (materialized === undefined) {
      await writeJsonAtomic(path, canonical)
      return canonical
    }
    assertRevision(materialized.revision)
    if (typeof materialized.commitId !== 'string' || materialized.commitId === '') {
      throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has an invalid materialized HEAD`)
    }
    if (materialized.revision === canonical.revision && materialized.commitId === canonical.commitId) return canonical
    if (!canonicalHeads.some(head => head.revision === materialized.revision && head.commitId === materialized.commitId)) {
      throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' materialized HEAD is not explained by its Work Session`)
    }
    await writeJsonAtomic(path, canonical)
    return canonical
  }

  /**
   * Return newest-first commit metadata for audit and replay evidence.
   * @param surfaceInput - Surface id to validate.
   * @returns The complete newest-first commit chain.
   */
  async history(surfaceInput: string): Promise<readonly CommitRecord[]> {
    const surface = SurfaceId(surfaceInput)
    const records: CommitRecord[] = []
    let cursor: string | null = (await this.readHead(surface)).commitId
    const seen = new Set<string>()
    while (cursor !== null) {
      if (seen.has(cursor)) throw new WorkSurfaceError('canonical-corrupt', `commit cycle detected at '${cursor}'`)
      seen.add(cursor)
      const record: CommitRecord = await this.readCommit(surface, cursor)
      records.push(record)
      cursor = record.parentCommitId
    }
    return records
  }

  /**
   * Report whether one Surface has a canonical Work Session without replaying its events.
   * @param surfaceInput - Surface id to check.
   * @returns True when the Surface owns a Work Session; corruption is surfaced as an error.
   */
  async hasSurface(surfaceInput: string): Promise<boolean> {
    const surface = SurfaceId(surfaceInput)
    try {
      await this.sessions.readHeader(surface)
      return true
    } catch (error) {
      if (error instanceof WorkSurfaceError && error.code === 'not-found') return false
      throw error
    }
  }

  /** Read the canonical Work Session physically owned by one Surface. */
  async readWorkSession(surfaceInput: string): Promise<WorkSessionSnapshot> {
    await this.readHead(surfaceInput)
    return this.sessions.read(surfaceInput)
  }

  /** Persist one immutable Orchestrator definition under the shared canonical directory. */
  async defineOrchestrator(language: 'bash' | 'python', source: string): Promise<OrchestratorDefinition> {
    if (source.trim() === '') throw new WorkSurfaceError('invalid-working-copy', 'Orchestrator source must not be blank')
    await this.init()
    const codeHash = sha256(`${language}\0${source}`)
    const revision = `sha256:${codeHash}` as Revision
    const root = join(this.canonicalRoot, 'orchestrator', 'definitions', codeHash)
    const existing = await readJsonOptional<Omit<OrchestratorDefinition, 'source'>>(join(root, 'manifest.json'))
    if (existing !== undefined) return this.readOrchestratorDefinition(revision)
    const temporary = join(this.canonicalRoot, 'orchestrator', 'definitions', `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`)
    try {
      await mkdir(temporary, { recursive: true, mode: 0o700 })
      await writeFile(join(temporary, 'program'), source, { mode: 0o600, flag: 'wx' })
      await writeJsonAtomic(join(temporary, 'manifest.json'), { revision, language, codeHash })
      try {
        await rename(temporary, root)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
    return this.readOrchestratorDefinition(revision)
  }

  /** Read and verify one immutable Orchestrator definition. */
  async readOrchestratorDefinition(revision: Revision): Promise<OrchestratorDefinition> {
    assertRevision(revision)
    const codeHash = revision.slice('sha256:'.length)
    const root = join(this.canonicalRoot, 'orchestrator', 'definitions', codeHash)
    const manifest = await readJsonOptional<Omit<OrchestratorDefinition, 'source'>>(join(root, 'manifest.json'))
    if (manifest === undefined) throw new WorkSurfaceError('not-found', `Orchestrator definition '${revision}' does not exist`)
    const source = await readUtf8(join(root, 'program'))
    if (manifest.revision !== revision || manifest.codeHash !== codeHash
      || (manifest.language !== 'bash' && manifest.language !== 'python')
      || sha256(`${manifest.language}\0${source}`) !== codeHash) {
      throw new WorkSurfaceError('canonical-corrupt', `Orchestrator definition '${revision}' failed verification`)
    }
    return { ...manifest, source }
  }

  /**
   * Durably bind one independent Surface to exactly one Agent Session.
   * Repeating the same complete binding is idempotent; either identity being reused is rejected.
   */
  /**
   * Durably record one write-once delegation between an independent Surface and
   * exactly one Agent Session. Repeating the same complete binding is idempotent;
   * either identity being reused is rejected.
   */
  async bindSession(options: BindSurfaceSessionOptions): Promise<SurfaceSessionBinding> {
    await this.init()
    const surface = SurfaceId(options.surface)
    const rootSurface = SurfaceId(options.rootSurface)
    const sessionId = requireSessionId(options.sessionId, 'sessionId')
    const parentSessionId = options.parentSessionId === undefined
      ? undefined
      : requireSessionId(options.parentSessionId, 'parentSessionId')
    await this.readHead(surface)
    await this.readHead(rootSurface)
    if (options.role === 'root' && (surface !== rootSurface || parentSessionId !== undefined || options.input !== undefined)) {
      throw new WorkSurfaceError('invalid-working-copy', 'root Session binding must bind the root Surface without parent or delegated input')
    }
    if (options.role === 'delegated' && parentSessionId === undefined) {
      throw new WorkSurfaceError('invalid-working-copy', 'delegated Session binding requires parentSessionId')
    }
    if (options.input !== undefined) await this.validateSessionInput(surface, options.input)

    const candidate: Omit<SurfaceSessionBinding, 'createdAt' | 'updatedAt' | 'outputRevision'> = {
      surface,
      sessionId,
      role: options.role,
      rootSurface,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      ...(options.input === undefined ? {} : { input: options.input }),
    }
    const lock = join(this.runtimeRoot, 'locks', 'session-bindings.lock')
    await mkdir(join(this.runtimeRoot, 'locks'), { recursive: true, mode: 0o700 })
    return withRecoverableLock(lock, async () => {
      const existingForSurface = await this.readBindingRecord(surface)
      if (existingForSurface !== undefined) {
        if (sameBindingIdentity(existingForSurface, candidate)) return existingForSurface
        throw new WorkSurfaceError('session-binding-conflict', `Surface '${surface}' is already bound to Session '${existingForSurface.sessionId}'`, {
          surface,
          existingSessionId: existingForSurface.sessionId,
          requestedSessionId: sessionId,
        })
      }
      const existingForSession = await this.findBindingBySession(sessionId)
      if (existingForSession !== undefined) {
        throw new WorkSurfaceError('session-binding-conflict', `Session '${sessionId}' is already bound to Surface '${existingForSession.surface}'`, {
          sessionId,
          existingSurface: existingForSession.surface,
          requestedSurface: surface,
        })
      }
      const now = new Date().toISOString()
      const binding: SurfaceSessionBinding = { ...candidate, createdAt: now, updatedAt: now }
      await writeJsonAtomic(this.bindingPath(surface), binding)
      return binding
    })
  }

  /** Record the final committed revision on an existing delegation record. */
  async completeSessionBinding(surfaceInput: string, sessionIdInput: string, outputRevision: Revision): Promise<SurfaceSessionBinding> {
    const surface = SurfaceId(surfaceInput)
    const sessionId = requireSessionId(sessionIdInput, 'sessionId')
    assertRevision(outputRevision)
    await this.readSnapshot(surface, outputRevision)
    const lock = join(this.runtimeRoot, 'locks', 'session-bindings.lock')
    await mkdir(join(this.runtimeRoot, 'locks'), { recursive: true, mode: 0o700 })
    return withRecoverableLock(lock, async () => {
      const existing = await this.readBindingRecord(surface)
      if (existing === undefined || existing.sessionId !== sessionId) {
        throw new WorkSurfaceError('session-binding-conflict', `Surface '${surface}' is not bound to Session '${sessionId}'`, { surface, sessionId })
      }
      if (existing.outputRevision === outputRevision) return existing
      if (existing.outputRevision !== undefined) {
        throw new WorkSurfaceError('session-binding-conflict', `Session '${sessionId}' already completed at another revision`, {
          existingRevision: existing.outputRevision,
          requestedRevision: outputRevision,
        })
      }
      const completed: SurfaceSessionBinding = { ...existing, outputRevision, updatedAt: new Date().toISOString() }
      await writeJsonAtomic(this.bindingPath(surface), completed)
      return completed
    })
  }

  /**
   * Read the delegation record for either identity. A root Session resolves its
   * Surface deterministically from the Session id; other Sessions are found by
   * scanning records.
   */
  async readSessionBinding(identity: { readonly surface: string } | { readonly sessionId: string }): Promise<SurfaceSessionBinding | undefined> {
    if ('surface' in identity) {
      const surface = SurfaceId(identity.surface)
      await this.readHead(surface)
      return this.readBindingRecord(surface)
    }
    const sessionId = requireSessionId(identity.sessionId, 'sessionId')
    const rootSurface = sessionSurfaceId(sessionId)
    const rootRecord = await this.readBindingRecord(rootSurface)
    if (rootRecord !== undefined && rootRecord.sessionId === sessionId) return rootRecord
    return this.findBindingBySession(sessionId)
  }

  /** Return all delegation records in stable creation order. */
  async listSessionBindings(): Promise<readonly SurfaceSessionBinding[]> {
    await this.init()
    const bindings: SurfaceSessionBinding[] = []
    for (const name of await readdir(join(this.canonicalRoot, 'surfaces'))) {
      let surface: SurfaceIdType
      try {
        surface = SurfaceId(name)
      } catch {
        continue
      }
      const binding = await this.readBindingRecord(surface)
      if (binding !== undefined) bindings.push(binding)
    }
    return bindings.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.surface.localeCompare(right.surface))
  }

  /** Read and validate the write-once delegation record owned by one Surface. */
  private async readBindingRecord(surface: SurfaceIdType): Promise<SurfaceSessionBinding | undefined> {
    const record = await readJsonOptional<Record<string, unknown>>(this.bindingPath(surface))
    if (record === undefined) return undefined
    if (record.surface !== surface
      || (record.role !== 'root' && record.role !== 'delegated')
      || typeof record.createdAt !== 'string' || record.createdAt === ''
      || typeof record.updatedAt !== 'string' || record.updatedAt === '') {
      throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has an invalid delegation record`)
    }
    const sessionId = requireSessionId(String(record.sessionId), 'sessionId')
    const rootSurface = SurfaceId(String(record.rootSurface))
    const parentSessionId = record.parentSessionId === undefined
      ? undefined
      : requireSessionId(String(record.parentSessionId), 'parentSessionId')
    const input = record.input as SurfaceSessionInput | undefined
    if (record.input !== undefined && (typeof input !== 'object' || input === null
      || typeof input.profile !== 'string' || !Array.isArray(input.blockRevisions)
      || !Array.isArray(input.omittedBlockRevisions) || typeof input.surfaceRevision !== 'string')) {
      throw new WorkSurfaceError('canonical-corrupt', `Surface '${surface}' has an invalid delegation input`)
    }
    const outputRevision = record.outputRevision as Revision | undefined
    if (record.outputRevision !== undefined) assertRevision(String(record.outputRevision))
    return {
      surface,
      sessionId,
      role: record.role,
      rootSurface,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      ...(input === undefined ? {} : { input }),
      ...(outputRevision === undefined ? {} : { outputRevision }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  /** Scan every delegation record for one Session identity; duplicates are corruption. */
  private async findBindingBySession(sessionId: string): Promise<SurfaceSessionBinding | undefined> {
    const matches = (await this.listSessionBindings()).filter(binding => binding.sessionId === sessionId)
    if (matches.length > 1) throw new WorkSurfaceError('canonical-corrupt', `Session '${sessionId}' is bound to multiple Surfaces`)
    return matches[0]
  }

  private bindingPath(surface: SurfaceIdType): string {
    return join(this.paths(surface).surfaceRoot, 'binding.json')
  }

  /** Build the current Surface DAG for one top-level Session Surface. */
  async graphSnapshot(rootSurfaceInput: string): Promise<WorkSurfaceGraphSnapshot> {
    const rootSurface = SurfaceId(rootSurfaceInput)
    await this.readHead(rootSurface)
    const snapshots = new Map<SurfaceIdType, SurfaceSnapshot>()
    const included = new Set<SurfaceIdType>([rootSurface])
    const sessions = new Map<SurfaceIdType, WorkSessionSnapshot>()
    const queue: SurfaceIdType[] = [rootSurface]
    while (queue.length > 0) {
      const surface = queue.shift()
      if (surface === undefined) break
      const session = await this.sessions.read(surface)
      sessions.set(surface, session)
      snapshots.set(surface, await this.readSnapshot(surface))
      for (const event of session.events) {
        if (event.type !== 'child/created') continue
        const child = SurfaceId((event.data as { childSurfaceId: string }).childSurfaceId)
        if (included.has(child)) {
          throw new WorkSurfaceError('canonical-corrupt', `WorkGraph '${rootSurface}' contains a repeated or cyclic child '${child}'`)
        }
        const childSession = await this.sessions.read(child)
        if (childSession.header.parentSurfaceId !== surface) {
          throw new WorkSurfaceError('canonical-corrupt', `child '${child}' does not name parent '${surface}'`)
        }
        included.add(child)
        queue.push(child)
      }
    }
    const bindings = await this.listSessionBindings()
    const bindingBySurface = new Map(bindings.map(binding => [binding.surface, binding]))
    const nodes: WorkSurfaceGraphNode[] = []
    for (const surface of [...included].sort()) {
      const snapshot = snapshots.get(surface)
      if (snapshot === undefined) continue
      const envelope = parseSurfaceDocument(snapshot.surfaceDocument)
      const session = sessions.get(surface)
      if (session === undefined) throw new WorkSurfaceError('canonical-corrupt', `missing Work Session '${surface}' during Graph fold`)
      const binding = bindingBySurface.get(surface)
      nodes.push({
        surface,
        sessionId: binding?.sessionId ?? null,
        phase: binding === undefined ? 'draft' : binding.outputRevision === undefined ? 'bound' : 'completed',
        revision: snapshot.revision,
        parent: session.header.parentSurfaceId,
        status: envelope.status,
        surfaceDocument: snapshot.surfaceDocument,
        blocks: [...snapshot.blocks].map(([block, content]) => {
          const parsed = parseBlockDocument(content, `Block '${block}'`)
          return { block, kind: parsed.kind, status: parsed.status, content }
        }),
      })
    }
    const edges: WorkSurfaceDependencyEdge[] = []
    for (const target of nodes) {
      const binding = bindingBySurface.get(target.surface)
      const refs = binding?.input?.blockRevisions ?? await this.currentInputRefs(target.surface, target.revision, target.surfaceDocument)
      const omitted = new Set((binding?.input?.omittedBlockRevisions ?? []).map(blockRefKey))
      for (const [index, ref] of refs.entries()) {
        if (ref.surface === target.surface || !included.has(ref.surface)) continue
        edges.push({
          id: sha256(`${ref.surface}\0${target.surface}\0${ref.block}\0${ref.revision}\0${target.revision}\0${index}`),
          kind: 'information',
          source: ref.surface,
          target: target.surface,
          sourceBlock: ref.block,
          sourceRevision: ref.revision,
          targetRevision: binding?.input?.surfaceRevision ?? target.revision,
          omitted: omitted.has(blockRefKey(ref)),
        })
      }
    }
    return {
      rootSurface,
      rootSessionId: bindingBySurface.get(rootSurface)?.sessionId ?? null,
      createdAt: new Date().toISOString(),
      nodes,
      edges,
    }
  }

  private async ensureNewSurfaceFacts(
    surface: SurfaceIdType,
    parent: SurfaceIdType | null,
    commitId: string,
    options: { readonly attemptId: string },
    result: NewSurfaceResult,
  ): Promise<void> {
    await this.sessions.initialize(surface, parent, { revision: result.revision, commitId }, {
      attemptId: options.attemptId,
      idempotencyKey: `surface-created:${commitId}`,
    })
    if (parent !== null) {
      await this.sessions.append({
        surface: parent,
        type: 'child/created',
        data: { childSurfaceId: surface, initialRevision: result.revision },
        attemptId: options.attemptId,
        idempotencyKey: `child-created:${commitId}`,
      })
    }
  }

  private async ensureCommitFact(
    surface: SurfaceIdType,
    commitId: string,
    options: { readonly attemptId: string },
    result: CommitResult,
  ): Promise<void> {
    await this.sessions.append({
      surface,
      type: 'surface/revision-published',
      data: {
        revision: result.revision,
        previousRevision: result.previousRevision,
        commitId,
      },
      attemptId: options.attemptId,
      idempotencyKey: `surface-revision-published:${commitId}`,
    })
  }

  private async validateSessionInput(surface: SurfaceIdType, input: SurfaceSessionInput): Promise<void> {
    if (input.profile.trim() === '') throw new WorkSurfaceError('unsupported-profile', 'Session input profile must not be blank')
    await this.readSnapshot(surface, input.surfaceRevision)
    await this.validateOutputRefs(input.blockRevisions)
    const available = new Set(input.blockRevisions.map(blockRefKey))
    for (const omitted of input.omittedBlockRevisions) {
      if (!available.has(blockRefKey(omitted))) {
        throw new WorkSurfaceError('invalid-reference', 'omitted Session input must also occur in blockRevisions', { omitted })
      }
    }
  }

  private async currentInputRefs(surface: SurfaceIdType, revision: Revision, document: string): Promise<readonly BlockRef[]> {
    const refs: BlockRef[] = []
    for (const reference of parseBlockReferences(document)) {
      refs.push({
        ...reference,
        revision: reference.surface === surface ? revision : (await this.readHead(reference.surface)).revision,
      })
    }
    return refs
  }

  private paths(surface: SurfaceIdType) {
    const surfaceRoot = join(this.canonicalRoot, 'surfaces', surface)
    return {
      surfaceRoot,
      head: join(surfaceRoot, 'HEAD.json'),
      lock: join(surfaceRoot, 'HEAD.lock'),
      revisions: join(surfaceRoot, 'revisions'),
      commits: join(surfaceRoot, 'commits'),
    }
  }

  private async validateSnapshot(surface: SurfaceIdType, snapshot: MutableSnapshot, parent: SurfaceIdType | null): Promise<void> {
    const envelope = parseSurfaceDocument(snapshot.surfaceDocument)
    if (envelope.surfaceId !== surface || envelope.parent !== parent) {
      throw new WorkSurfaceError('invalid-working-copy', 'surface.md envelope does not match the target Surface', {
        expectedSurface: surface,
        actualSurface: envelope.surfaceId,
        expectedParent: parent,
        actualParent: envelope.parent,
      })
    }
    if (parent !== null) await this.readHead(parent)
    for (const [pathBlock, content] of snapshot.blocks) {
      const block = parseBlockDocument(content, `Block '${pathBlock}'`)
      if (block.blockId !== pathBlock || block.surfaceId !== surface) {
        throw new WorkSurfaceError('block-header-mismatch', `Block '${pathBlock}' metadata does not match its canonical path`, {
          pathBlock,
          headerBlock: block.blockId,
          headerSurface: block.surfaceId,
          expectedSurface: surface,
        })
      }
    }
    const documents = [snapshot.surfaceDocument, ...snapshot.blocks.values()]
    for (const document of documents) {
      for (const ref of parseBlockReferences(document)) {
        if (ref.surface === surface) {
          if (!snapshot.blocks.has(ref.block)) {
            throw new WorkSurfaceError('dangling-reference', `reference '${ref.surface}/${ref.block}' has no candidate Block`, { ref })
          }
        } else {
          const referenced = await this.readSnapshot(ref.surface)
          if (!referenced.blocks.has(ref.block)) {
            throw new WorkSurfaceError('dangling-reference', `reference '${ref.surface}/${ref.block}' has no committed Block`, { ref })
          }
        }
      }
    }
  }

  private async writeRevision(surface: SurfaceIdType, revision: Revision, snapshot: MutableSnapshot): Promise<void> {
    const paths = this.paths(surface)
    const finalPath = join(paths.revisions, revision.slice('sha256:'.length))
    try {
      await stat(finalPath)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    }
    await mkdir(paths.revisions, { recursive: true, mode: 0o700 })
    const temporary = join(paths.revisions, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`)
    try {
      await mkdir(join(temporary, 'blocks'), { recursive: true, mode: 0o700 })
      await writeFile(join(temporary, 'surface.md'), snapshot.surfaceDocument, { mode: 0o600, flag: 'wx' })
      for (const [block, content] of snapshot.blocks) {
        await writeFile(join(temporary, 'blocks', `${block}.md`), content, { mode: 0o600, flag: 'wx' })
      }
      try {
        await rename(temporary, finalPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST' && (error as NodeJS.ErrnoException | null)?.code !== 'ENOTEMPTY') throw error
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  private async readCommit<T = unknown>(surface: SurfaceIdType, commitId: string): Promise<CommitRecord<T>> {
    const record = await this.readCommitOptional<T>(surface, commitId)
    if (record === undefined) {
      throw new WorkSurfaceError('canonical-corrupt', `missing or invalid commit '${commitId}' for Surface '${surface}'`)
    }
    return record
  }

  private async readCommitOptional<T = unknown>(surface: SurfaceIdType, commitId: string): Promise<CommitRecord<T> | undefined> {
    const record = await readJsonOptional<CommitRecord<T>>(join(this.paths(surface).commits, `${commitId}.json`))
    if (record === undefined) return undefined
    if (record.commitId !== commitId || record.surface !== surface) {
      throw new WorkSurfaceError('canonical-corrupt', `invalid commit '${commitId}' for Surface '${surface}'`)
    }
    return record
  }

  private async reconcileCommit<T>(surface: SurfaceIdType, commitId: string): Promise<T | undefined> {
    const pending = await this.readCommitOptional<T>(surface, commitId)
    let cursor: string | null
    try {
      cursor = (await this.readHead(surface)).commitId
    } catch (error) {
      if (error instanceof WorkSurfaceError && error.code === 'not-found') {
        return pending?.parentCommitId === null ? pending.result : undefined
      }
      throw error
    }
    if (pending?.parentCommitId === cursor) return pending.result
    const seen = new Set<string>()
    while (cursor !== null) {
      if (cursor === commitId) return (await this.readCommit<T>(surface, cursor)).result
      if (seen.has(cursor)) throw new WorkSurfaceError('canonical-corrupt', `commit cycle detected at '${cursor}'`)
      seen.add(cursor)
      cursor = (await this.readCommit(surface, cursor)).parentCommitId
    }
    return undefined
  }
}

function requireSessionId(value: string, label: string): string {
  if (value.trim() === '' || value.includes('\0')) throw new WorkSurfaceError('invalid-id', `${label} must be a non-blank Session id`)
  return value
}

function blockRefKey(ref: BlockRef): string {
  return `${ref.surface}\0${ref.block}\0${ref.revision}`
}

function sameBindingIdentity(
  existing: SurfaceSessionBinding,
  candidate: Omit<SurfaceSessionBinding, 'createdAt' | 'updatedAt' | 'outputRevision'>,
): boolean {
  return stableStringify({
    surface: existing.surface,
    sessionId: existing.sessionId,
    role: existing.role,
    rootSurface: existing.rootSurface,
    parentSessionId: existing.parentSessionId,
    input: existing.input,
  }) === stableStringify(candidate)
}

function instantiateTemplate(template: MutableSnapshot, surface: SurfaceIdType, parent: SurfaceIdType | null): MutableSnapshot {
  return {
    surfaceDocument: instantiateSurfaceDocument(template.surfaceDocument, surface, parent),
    blocks: new Map([...template.blocks].map(([block, content]) => [block, instantiateBlockDocument(content, surface, block)])),
  }
}

async function readWorkingTree(inputPath: string): Promise<MutableSnapshot> {
  const root = resolve(inputPath)
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name !== 'surface.md' && entry.name !== 'blocks') {
      throw new WorkSurfaceError('invalid-working-copy', `unexpected working-copy entry '${entry.name}'`)
    }
    if (entry.isSymbolicLink()) throw new WorkSurfaceError('invalid-working-copy', `working-copy symlink '${entry.name}' is forbidden`)
  }
  const surfaceEntry = entries.find(entry => entry.name === 'surface.md')
  if (!surfaceEntry?.isFile()) throw new WorkSurfaceError('invalid-working-copy', `${root} requires a regular surface.md`)
  const surfaceDocument = await readUtf8(join(root, 'surface.md'))
  const blocks = new Map<BlockIdType, string>()
  const blocksEntry = entries.find(entry => entry.name === 'blocks')
  if (blocksEntry) {
    if (!blocksEntry.isDirectory()) throw new WorkSurfaceError('invalid-working-copy', 'blocks must be a directory')
    for (const entry of await readdir(join(root, 'blocks'), { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md')) {
        throw new WorkSurfaceError('invalid-working-copy', `invalid blocks entry '${entry.name}'`)
      }
      const block = BlockId(basename(entry.name, '.md'))
      blocks.set(block, await readUtf8(join(root, 'blocks', entry.name)))
    }
  }
  return { surfaceDocument, blocks }
}

async function readUtf8(path: string): Promise<string> {
  const bytes = await readFile(path)
  try {
    const content = UTF8.decode(bytes)
    if (content.includes('\0')) throw new Error('contains NUL')
    return content
  } catch (error) {
    throw new WorkSurfaceError('invalid-working-copy', `${path} is not valid UTF-8 text`, {
      cause: String(error),
    })
  }
}

function effectRequestHash(type: string, request: unknown): string {
  return sha256(stableStringify({ type, request }))
}

function effectCommitId(attemptId: string, key: string, requestHash: string): string {
  return sha256(`${attemptId}\0${key}\0${requestHash}`)
}

function createCommitRecord<T>(
  surface: SurfaceIdType,
  revision: Revision,
  parentCommitId: string | null,
  commitId: string,
  options: { readonly attemptId: string; readonly key: string },
  type: string,
  requestHash: string,
  result: T,
): CommitRecord<T> {
  return {
    commitId,
    surface,
    revision,
    parentCommitId,
    effect: { attemptId: options.attemptId, key: options.key, type, requestHash },
    result,
    createdAt: new Date().toISOString(),
  }
}

function assertRevision(value: string): asserts value is Revision {
  if (!REVISION_RE.test(value)) throw new WorkSurfaceError('invalid-id', `invalid revision '${value}'`, { value })
}

function foldSurfaceHeads(session: WorkSessionSnapshot): SurfaceHead[] {
  const heads: SurfaceHead[] = []
  for (const event of session.events) {
    if (event.type !== 'surface/created' && event.type !== 'surface/revision-published') continue
    const data = event.data as { readonly revision: Revision; readonly commitId: string }
    assertRevision(data.revision)
    if (typeof data.commitId !== 'string' || data.commitId === '') {
      throw new WorkSurfaceError('canonical-corrupt', `Work Session '${session.header.surfaceId}' contains an invalid commit id`)
    }
    heads.push({ revision: data.revision, commitId: data.commitId })
  }
  return heads
}

async function readJsonOptional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) throw new WorkSurfaceError('canonical-corrupt', `invalid JSON at ${path}`)
    throw error
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

async function readdirOptional(path: string): Promise<string[] | undefined> {
  try {
    return await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    throw error
  }
}
