import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { WorkSurfaceError } from './error.ts'
import { sha256, stableStringify } from './hash.ts'
import { RevisionStore, type RevisionKind, type RevisionManifestEntry } from './revision-store.ts'
import type { Revision } from './event-model.ts'
import { acquireRuntimeLock, durableCreate, syncDirectory } from './runtime-store-io.ts'

export interface WorkspaceFile { readonly version: string; readonly content: Buffer | null }
export interface WorkspaceChange { readonly path: string; readonly expectedVersion: string; readonly content: Buffer | null }
export type WorkspaceEditResult =
  | { readonly status: 'committed' | 'unchanged'; readonly revision: Revision }
  | { readonly status: 'conflict'; readonly revision: Revision; readonly files: readonly (WorkspaceFile & { readonly path: string })[] }

interface WorkspaceIntent {
  readonly version: 1
  readonly operationId: string
  readonly prefix: string
  readonly before: Revision
  readonly after: Revision
  readonly requestHash: string
}

/** An accepted immutable candidate whose file projection still needs recovery. */
export class WorkspaceProjectionError extends WorkSurfaceError {
  constructor(readonly revision: Revision, readonly operationId: string, cause: unknown) {
    super('effect-failed', `workspace projection '${operationId}' requires recovery: ${cause instanceof Error ? cause.message : String(cause)}`, { revision, operationId })
  }
}

/**
 * A versioned, mutable directory. It owns no Surface, Agent, editor or business
 * publication semantics. All managed writers use this lock and durable intent;
 * ordinary file changes are captured or rejected, never reset on observation.
 */
export class FileWorkspace {
  readonly root: string
  readonly stateRoot: string
  constructor(root: string, stateRoot: string, readonly revisions: RevisionStore) {
    this.root = resolve(root)
    this.stateRoot = resolve(stateRoot)
    if (this.stateRoot === this.root || this.stateRoot.startsWith(`${this.root}${sep}`)) throw new WorkSurfaceError('invalid-working-copy', 'workspace state must be outside its mutable directory')
  }

  async transaction<T>(operation: (view: LockedFileWorkspace) => Promise<T>): Promise<T> {
    return this.withLockedView(operation, true)
  }

  /** Observe existing files without projecting pending writes, including after a crash. */
  observe(prefix = '', kind: RevisionKind = 'artifact'): Promise<Revision> {
    return this.withLockedView(view => view.snapshot(prefix, kind), false)
  }

  private async withLockedView<T>(operation: (view: LockedFileWorkspace) => Promise<T>, recoverFirst: boolean): Promise<T> {
    if (recoverFirst) await mkdir(this.root, { recursive: true })
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    const release = await acquireRuntimeLock(join(this.stateRoot, 'writer.lock'))
    const lease = { active: true }
    const view = new LockedFileWorkspace(this, lease)
    try {
      await this.assertStateIdentity()
      if (recoverFirst) await view.recover()
      return await operation(view)
    } finally { await view.finish(); lease.active = false; await release() }
  }

  private async assertStateIdentity(): Promise<void> {
    const path = join(this.stateRoot, 'workspace.json')
    const identity = { version: 1, root: this.root, revisionsRoot: this.revisions.root }
    let stored: unknown
    try { stored = JSON.parse(await readFile(path, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await durableCreate(path, identity); return }
      if (error instanceof SyntaxError) throw new WorkSurfaceError('canonical-corrupt', 'workspace identity is invalid JSON')
      throw error
    }
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored) || stableStringify(Object.keys(stored).sort()) !== stableStringify(['revisionsRoot', 'root', 'version']) || (stored as typeof identity).version !== 1 || typeof (stored as typeof identity).root !== 'string' || typeof (stored as typeof identity).revisionsRoot !== 'string') throw new WorkSurfaceError('canonical-corrupt', 'workspace identity has an invalid shape')
    if (stableStringify(stored) !== stableStringify(identity)) throw new WorkSurfaceError('invalid-working-copy', 'workspace journal belongs to a different authoring directory or Revision store')
  }

  snapshot(prefix = '', kind: RevisionKind = 'artifact'): Promise<Revision> {
    return this.transaction(view => view.snapshot(prefix, kind))
  }

  recover(): Promise<void> { return this.transaction(async () => undefined) }

  async readFile(revision: Revision, path: string): Promise<WorkspaceFile> {
    validateRelative(path)
    const manifest = await this.revisions.read(revision)
    const entry = manifest.entries.find(item => item.path === path)
    return entry === undefined ? { version: 'absent', content: null } : {
      version: `sha256:${entry.sha256}`, content: await this.revisions.readFile(revision, path),
    }
  }

  edit(operationId: string, changes: readonly WorkspaceChange[]): Promise<WorkspaceEditResult> {
    return this.transaction(view => view.edit(operationId, changes))
  }

  /** Import a revision into a new/empty subtree through the same durable writer. */
  materialize(revision: Revision, prefix: string, operationId: string): Promise<Revision> {
    return this.transaction(view => view.materialize(revision, prefix, operationId))
  }
}

/** Valid only for the duration of FileWorkspace.transaction(). */
export class LockedFileWorkspace {
  private accepting = true
  private mutation: Promise<void> = Promise.resolve()
  constructor(private readonly workspace: FileWorkspace, private readonly lease: { readonly active: boolean }) {}

  snapshot(prefix = '', kind: RevisionKind = 'artifact'): Promise<Revision> { return this.enqueue(() => this.snapshotLocked(prefix, kind)) }
  edit(operationId: string, changes: readonly WorkspaceChange[]): Promise<WorkspaceEditResult> { return this.enqueue(() => this.editLocked(operationId, changes)) }
  materialize(revision: Revision, prefix: string, operationId: string): Promise<Revision> { return this.enqueue(() => this.materializeLocked(revision, prefix, operationId)) }
  replace(prefix: string, expected: Revision, candidate: Revision, operationId: string, requestHash?: string): Promise<void> { return this.enqueue(() => this.replaceLocked(prefix, expected, candidate, operationId, requestHash)) }
  /** Validate a proposed replacement before a caller records its own durable intent. */
  checkReplace(prefix: string, expected: Revision, candidate: Revision): Promise<void> { return this.enqueue(() => this.checkReplaceLocked(prefix, expected, candidate)) }
  recover(): Promise<void> { return this.enqueue(() => this.recoverLocked()) }

  /** Close admission and drain operations before the owner releases its process lock. */
  async finish(): Promise<void> { this.accepting = false; await this.mutation }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting || !this.lease.active) return Promise.reject(new WorkSurfaceError('unauthorized', 'workspace transaction lease has ended'))
    const result = this.mutation.then(operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private async snapshotLocked(prefix = '', kind: RevisionKind = 'artifact'): Promise<Revision> {
    this.assertLease()
    const path = await this.target(prefix, true)
    const snapshot = await this.workspace.revisions.snapshot(path, kind)
    // Snapshot references can outlive an editor or host process. They must not
    // be collected while an observation or a pending intent still refers to them.
    await this.workspace.revisions.pin(snapshot.revision)
    return snapshot.revision
  }

  private async editLocked(operationId: string, changes: readonly WorkspaceChange[]): Promise<WorkspaceEditResult> {
    this.assertLease()
    requireOperationId(operationId)
    const paths = new Set<string>()
    for (const change of changes) {
      validateRelative(change.path)
      if (!/^(?:absent|sha256:[0-9a-f]{64})$/.test(change.expectedVersion) || (change.content !== null && !Buffer.isBuffer(change.content))) throw new WorkSurfaceError('invalid-working-copy', `invalid workspace change '${change.path}'`)
      if (paths.has(change.path)) throw new WorkSurfaceError('invalid-working-copy', `duplicate workspace path '${change.path}'`)
      paths.add(change.path)
    }
    const requestHash = sha256(stableStringify(changes.map(change => ({ path: change.path, expectedVersion: change.expectedVersion, content: change.content === null ? null : sha256(change.content) }))))
    const previous = await this.intentAt(this.receiptPath(operationId))
    if (previous !== undefined && previous.requestHash !== requestHash) throw new WorkSurfaceError('already-exists-conflict', 'workspace operation id was reused for different changes')
    const revision = await this.snapshotLocked()
    const files = await Promise.all(changes.map(change => this.workspace.readFile(revision, change.path)))
    const conflicts = changes.flatMap((change, index) => {
      const current = files[index]!
      // A retried committed request never reapplies or rolls back later work.
      const expected = previous === undefined ? change.expectedVersion : change.content === null ? 'absent' : `sha256:${sha256(change.content)}`
      return current.version === expected ? [] : [{ path: change.path, ...current }]
    })
    if (conflicts.length > 0) return { status: 'conflict', revision, files: conflicts }
    if (previous !== undefined) return { status: 'unchanged', revision }
    if (changes.every((change, index) => equalBytes(change.content, files[index]!.content))) {
      await durableCreate(this.receiptPath(operationId), { version: 1, operationId, prefix: '', before: revision, after: revision, requestHash } satisfies WorkspaceIntent)
      return { status: 'unchanged', revision }
    }
    const before = await this.workspace.revisions.read(revision)
    const after = new Map(before.entries.map(entry => [entry.path, entry]))
    for (const change of changes) {
      if (change.content === null) after.delete(change.path)
      else after.set(change.path, { path: change.path, type: 'file', executable: after.get(change.path)?.executable ?? false, size: change.content.length, sha256: sha256(change.content) })
    }
    rejectTopologyChanges(before.entries, [...after.values()])
    const stage = join(this.workspace.stateRoot, 'staging', randomUUID())
    try {
      await this.workspace.revisions.materialize(revision, stage)
      for (const change of changes) {
        const path = join(stage, change.path)
        if (change.content === null) await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
        else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, change.content) }
      }
      const candidate = (await this.workspace.revisions.snapshot(stage, 'artifact')).revision
      await this.replaceLocked('', revision, candidate, operationId, requestHash)
      return { status: 'committed', revision: candidate }
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  private async materializeLocked(revision: Revision, prefix: string, operationId: string): Promise<Revision> {
    this.assertLease()
    validateRelative(prefix)
    requireOperationId(operationId)
    const requestHash = sha256(stableStringify({ materialize: revision, prefix }))
    const previous = await this.intentAt(this.receiptPath(operationId))
    if (previous !== undefined) {
      if (previous.requestHash !== requestHash) throw new WorkSurfaceError('already-exists-conflict', 'materialization id was reused for a different revision or destination')
      return previous.after
    }
    if ((await this.workspace.revisions.read(revision)).entries.length === 0) throw new WorkSurfaceError('invalid-working-copy', 'empty directories are not versioned; materialization requires at least one file')
    const target = await this.target(prefix)
    try {
      if ((await readdir(target)).length > 0) throw new WorkSurfaceError('target-not-empty', 'revision materialization requires a new or empty directory')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const before = await this.snapshotLocked()
    const stage = join(this.workspace.stateRoot, 'staging', randomUUID())
    try {
      await this.workspace.revisions.materialize(before, stage)
      await this.workspace.revisions.materialize(revision, join(stage, prefix))
      const candidate = (await this.workspace.revisions.snapshot(stage, 'artifact')).revision
      await this.replaceLocked('', before, candidate, operationId, requestHash)
      return candidate
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  /** Compare a whole subtree, record intent, then project only its exact delta. */
  private async replaceLocked(prefix: string, expected: Revision, candidate: Revision, operationId: string, requestHash?: string): Promise<void> {
    this.assertLease()
    requireOperationId(operationId)
    validateRelative(prefix, true)
    const [before, after] = await Promise.all([this.workspace.revisions.read(expected), this.workspace.revisions.read(candidate)])
    if (before.kind !== after.kind) throw new WorkSurfaceError('invalid-working-copy', 'workspace replacement changes revision kind')
    rejectTopologyChanges(before.entries, after.entries)
    const existing = await this.intentAt(this.receiptPath(operationId))
    const intent: WorkspaceIntent = { version: 1, operationId, prefix, before: expected, after: candidate, requestHash: requestHash ?? sha256(stableStringify({ prefix, expected, candidate })) }
    if (existing !== undefined) {
      if (stableStringify(existing) !== stableStringify(intent)) throw new WorkSurfaceError('already-exists-conflict', 'workspace operation id was reused')
      return
    }
    const actual = await this.snapshotLocked(prefix, before.kind)
    if (actual !== expected && actual !== candidate) throw new WorkSurfaceError('revision-conflict', 'unpublished workspace changes conflict with the candidate', { prefix, expected, actual, candidate })
    // Reject unsupported or conflicting projections before accepting an intent.
    await this.preflight(intent, before.entries, after.entries)
    await this.workspace.revisions.pin(expected)
    await this.workspace.revisions.pin(candidate)
    await durableCreate(this.pendingPath(operationId), intent)
    try { await this.project(intent) }
    catch (error) { throw new WorkspaceProjectionError(candidate, operationId, error) }
  }

  private async checkReplaceLocked(prefix: string, expected: Revision, candidate: Revision): Promise<void> {
    this.assertLease()
    validateRelative(prefix, true)
    const [before, after] = await Promise.all([this.workspace.revisions.read(expected), this.workspace.revisions.read(candidate)])
    if (before.kind !== after.kind) throw new WorkSurfaceError('invalid-working-copy', 'workspace replacement changes revision kind')
    rejectTopologyChanges(before.entries, after.entries)
    const actual = await this.snapshotLocked(prefix, before.kind)
    if (actual !== expected && actual !== candidate) throw new WorkSurfaceError('revision-conflict', 'unpublished workspace changes conflict with the candidate', { prefix, expected, actual, candidate })
    await this.preflight({ prefix }, before.entries, after.entries)
  }

  private async recoverLocked(): Promise<void> {
    this.assertLease()
    const root = join(this.workspace.stateRoot, 'pending')
    await mkdir(root, { recursive: true, mode: 0o700 })
    for (const name of (await readdir(root)).filter(name => name.endsWith('.json')).sort()) {
      const intent = await this.intentAt(join(root, name))
      if (intent === undefined) continue
      try { await this.project(intent) }
      catch (error) { throw new WorkspaceProjectionError(intent.after, intent.operationId, error) }
    }
  }

  private async project(intent: WorkspaceIntent): Promise<void> {
    this.assertLease()
    const [before, after] = await Promise.all([this.workspace.revisions.read(intent.before), this.workspace.revisions.read(intent.after)])
    if (before.kind !== after.kind) throw new WorkSurfaceError('canonical-corrupt', 'workspace intent changes revision kind')
    rejectTopologyChanges(before.entries, after.entries)
    const oldFiles = new Map(before.entries.map(entry => [entry.path, entry]))
    const newFiles = new Map(after.entries.map(entry => [entry.path, entry]))
    const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()
    // Preflight the entire delta before touching any file; repeat just before
    // each rename to detect ordinary writers that do not participate in the lock.
    await this.preflight(intent, before.entries, after.entries)
    for (const path of paths) {
      const oldEntry = oldFiles.get(path), newEntry = newFiles.get(path)
      if (sameEntry(oldEntry, newEntry)) continue
      const current = await this.assertCurrent(intent.prefix, path, oldEntry, newEntry)
      if (sameEntry(current, newEntry)) continue
      const target = await this.target(join(intent.prefix, path))
      if (newEntry === undefined) {
        await unlink(target)
        await syncDirectory(dirname(target))
        continue
      }
      await mkdir(dirname(target), { recursive: true })
      const temporary = join(this.workspace.stateRoot, `${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(await this.workspace.revisions.readFile(intent.after, path)); await handle.sync() } finally { await handle.close() }
      try {
        await chmod(temporary, newEntry.executable ? 0o755 : 0o644)
        this.assertLease()
        await this.assertCurrent(intent.prefix, path, oldEntry, newEntry)
        await rename(temporary, target)
        await syncDirectory(dirname(target))
      } finally { await rm(temporary, { force: true }) }
    }
    const actual = await this.snapshotLocked(intent.prefix, after.kind)
    if (actual !== intent.after) throw new WorkSurfaceError('revision-conflict', 'workspace changed while projecting the candidate', { expected: intent.after, actual })
    const receipt = this.receiptPath(intent.operationId)
    const prior = await this.intentAt(receipt)
    if (prior === undefined) await durableCreate(receipt, intent)
    else if (stableStringify(prior) !== stableStringify(intent)) throw new WorkSurfaceError('canonical-corrupt', 'workspace receipt disagrees with pending intent')
    await unlink(this.pendingPath(intent.operationId))
    await syncDirectory(join(this.workspace.stateRoot, 'pending'))
  }

  private async preflight(intent: Pick<WorkspaceIntent, 'prefix'>, before: readonly RevisionManifestEntry[], after: readonly RevisionManifestEntry[]): Promise<void> {
    const oldFiles = new Map(before.map(entry => [entry.path, entry]))
    const newFiles = new Map(after.map(entry => [entry.path, entry]))
    const target = await this.target(intent.prefix, true)
    const current = await this.workspace.revisions.snapshot(target, 'artifact')
    // Recovery may observe a mixture of before/after. Anything else is user work,
    // including a changed file outside the write delta or an additional file.
    for (const entry of current.manifest.entries) {
      if (!sameEntry(entry, oldFiles.get(entry.path)) && !sameEntry(entry, newFiles.get(entry.path))) throw new WorkSurfaceError('revision-conflict', `workspace path '${entry.path}' has unpublished changes`)
    }
    for (const path of new Set([...oldFiles.keys(), ...newFiles.keys()])) await this.assertCurrent(intent.prefix, path, oldFiles.get(path), newFiles.get(path))
  }

  private async assertCurrent(prefix: string, path: string, before?: RevisionManifestEntry, after?: RevisionManifestEntry): Promise<RevisionManifestEntry | undefined> {
    const target = await this.target(join(prefix, path))
    let current: RevisionManifestEntry | undefined
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) throw new WorkSurfaceError('revision-conflict', `workspace path '${path}' is not a regular file`)
      const content = await readFile(target)
      current = { path, type: 'file', executable: (info.mode & 0o111) !== 0, size: content.byteLength, sha256: sha256(content) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!sameEntry(current, before) && !sameEntry(current, after)) throw new WorkSurfaceError('revision-conflict', `workspace path '${path}' has unpublished changes`)
    return current
  }

  private async target(path: string, allowEmpty = false): Promise<string> {
    this.assertLease()
    validateRelative(path, allowEmpty)
    const target = resolve(this.workspace.root, path)
    const relation = relative(this.workspace.root, target)
    if (relation.startsWith(`..${sep}`) || relation === '..') throw new WorkSurfaceError('unauthorized', 'workspace path escapes root')
    let current = this.workspace.root
    for (const part of ['', ...relation.split(sep).filter(Boolean)]) {
      current = join(current, part)
      try { if ((await lstat(current)).isSymbolicLink()) throw new WorkSurfaceError('unauthorized', 'workspace path crosses a symbolic link') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return target
  }

  private pendingPath(id: string): string { return join(this.workspace.stateRoot, 'pending', `${sha256(id)}.json`) }
  private receiptPath(id: string): string { return join(this.workspace.stateRoot, 'receipts', `${sha256(id)}.json`) }
  private async intentAt(path: string): Promise<WorkspaceIntent | undefined> {
    let text: string
    try { text = await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    let value: WorkspaceIntent
    try { value = JSON.parse(text) as WorkspaceIntent } catch { throw new WorkSurfaceError('canonical-corrupt', 'workspace intent is invalid JSON') }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || stableStringify(Object.keys(value).sort()) !== stableStringify(['after', 'before', 'operationId', 'prefix', 'requestHash', 'version']) || value.version !== 1 || typeof value.operationId !== 'string' || !value.operationId || typeof value.prefix !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.before) || !/^sha256:[0-9a-f]{64}$/.test(value.after) || !/^[0-9a-f]{64}$/.test(value.requestHash)) throw new WorkSurfaceError('canonical-corrupt', 'workspace intent has an invalid shape')
    try { validateRelative(value.prefix, true) } catch { throw new WorkSurfaceError('canonical-corrupt', 'workspace intent prefix is unsafe') }
    if (!path.endsWith(`${sha256(value.operationId)}.json`)) throw new WorkSurfaceError('canonical-corrupt', 'workspace intent identity does not match its filename')
    return value
  }
  private assertLease(): void { if (!this.lease.active) throw new WorkSurfaceError('unauthorized', 'workspace transaction lease has ended') }
}

function validateRelative(value: string, allowEmpty = false): void {
  if ((allowEmpty && value === '')) return
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.split('/').some(part => part === '' || part === '.' || part === '..')) throw new WorkSurfaceError('invalid-working-copy', `invalid workspace path '${value}'`)
}
function requireOperationId(value: string): void { if (typeof value !== 'string' || !value) throw new WorkSurfaceError('invalid-id', 'workspace operation id must not be empty') }
function equalBytes(left: Buffer | null, right: Buffer | null): boolean { return left === null ? right === null : right !== null && left.equals(right) }
function sameEntry(left?: RevisionManifestEntry, right?: RevisionManifestEntry): boolean { return left === undefined ? right === undefined : right !== undefined && left.sha256 === right.sha256 && left.executable === right.executable }

/** File/directory topology conversion needs a separate authoring operation. */
function rejectTopologyChanges(before: readonly RevisionManifestEntry[], after: readonly RevisionManifestEntry[]): void {
  const oldPaths = new Set(before.map(entry => entry.path))
  const newPaths = new Set(after.map(entry => entry.path))
  for (const [entries, opposite] of [[before, newPaths], [after, oldPaths]] as const) for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let index = 1; index < parts.length; index++) if (opposite.has(parts.slice(0, index).join('/'))) throw new WorkSurfaceError('invalid-working-copy', `workspace replacement cannot convert a file to or from a directory at '${parts.slice(0, index).join('/')}'`)
  }
}
