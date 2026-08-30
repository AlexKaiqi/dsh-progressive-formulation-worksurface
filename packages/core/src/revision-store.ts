import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { defineOrchestration } from './event-model.ts'
import { sha256, stableStringify } from './hash.ts'
import { WorkSurfaceError } from './error.ts'
import type { Revision } from './event-model.ts'

export const SURFACE_SECTION_TITLES = Object.freeze([
  '# Goal',
  '# Acceptance Criteria',
  '# Known Facts and Constraints',
  '# Assumptions',
  '# Open Questions',
  '# Current Decisions',
  '# Deliverables and Evidence',
] as const)

export const SURFACE_TEMPLATE = `${SURFACE_SECTION_TITLES.join('\n\n')}\n`

export type RevisionKind = 'artifact' | 'surface' | 'definition'

export interface RevisionManifestEntry {
  readonly path: string
  readonly type: 'file'
  readonly executable: boolean
  readonly size: number
  readonly sha256: string
}

export interface RevisionManifest {
  readonly version: 1
  readonly kind: RevisionKind
  readonly entries: readonly RevisionManifestEntry[]
}

export interface SnapshotLimits {
  readonly maxFiles?: number
  readonly maxFileBytes?: number
  readonly maxTotalBytes?: number
}

export interface RevisionGcOptions {
  /** Every Revision reachable from durable Event/Registration facts. */
  readonly reachable: Iterable<Revision>
  /** Protect young objects from racing an in-flight snapshot. Defaults to 24 hours. */
  readonly minAgeMs?: number
  readonly now?: number
}

export interface RevisionGcResult {
  readonly markedRevisions: number
  readonly retainedRecentRevisions: number
  readonly sweptRevisions: readonly Revision[]
  readonly sweptBlobs: readonly string[]
  readonly sweptTemporaryFiles: number
}

const DEFAULT_LIMITS: Required<SnapshotLimits> = {
  maxFiles: 10_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
}

/** Immutable, content-addressed directory snapshots. */
export class RevisionStore {
  readonly root: string
  private maintenance: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.root = resolve(root)
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(join(this.root, 'blobs', 'sha256'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'manifests', 'sha256'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'tmp'), { recursive: true, mode: 0o700 }),
    ])
  }

  snapshotSurface(sourcePath: string, limits?: SnapshotLimits): Promise<{ revision: Revision; manifest: RevisionManifest }> {
    return this.snapshot(sourcePath, 'surface', limits)
  }

  snapshotDefinition(sourcePath: string, limits?: SnapshotLimits): Promise<{ revision: Revision; manifest: RevisionManifest }> {
    return this.snapshot(sourcePath, 'definition', limits)
  }

  async snapshot(sourcePath: string, kind: RevisionKind, configured: SnapshotLimits = {}): Promise<{ revision: Revision; manifest: RevisionManifest }> {
    await this.init()
    const source = resolve(sourcePath)
    const rootInfo = await lstat(source)
    if (!rootInfo.isDirectory()) throw new WorkSurfaceError('invalid-working-copy', 'revision source must be a directory')
    const limits = { ...DEFAULT_LIMITS, ...configured }
    const entries: RevisionManifestEntry[] = []
    let totalBytes = 0

    const walk = async (directory: string): Promise<void> => {
      const children = await readdir(directory, { withFileTypes: true })
      children.sort((left, right) => left.name.localeCompare(right.name))
      for (const child of children) {
        const path = join(directory, child.name)
        const name = normalizePath(relative(source, path))
        const pathInfo = await lstat(path)
        if (pathInfo.isSymbolicLink() || (!pathInfo.isDirectory() && !pathInfo.isFile())) throw new WorkSurfaceError('invalid-working-copy', `revision contains unsupported entry '${name}'`)
        if (pathInfo.isDirectory()) {
          await walk(path)
          continue
        }
        if (entries.length >= limits.maxFiles) throw new WorkSurfaceError('invalid-working-copy', `revision exceeds ${limits.maxFiles} files`)
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        let content: Buffer
        let executable: boolean
        try {
          const before = await handle.stat()
          if (!before.isFile()) throw new WorkSurfaceError('invalid-working-copy', `revision contains unsupported entry '${name}'`)
          content = await handle.readFile()
          const after = await handle.stat()
          if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode || content.byteLength !== after.size) {
            throw new WorkSurfaceError('revision-conflict', `file '${name}' changed during snapshot`)
          }
          executable = (after.mode & 0o111) !== 0
        } finally {
          await handle.close()
        }
        if (content.byteLength > limits.maxFileBytes) throw new WorkSurfaceError('invalid-working-copy', `file '${name}' exceeds ${limits.maxFileBytes} bytes`)
        totalBytes += content.byteLength
        if (totalBytes > limits.maxTotalBytes) throw new WorkSurfaceError('invalid-working-copy', `revision exceeds ${limits.maxTotalBytes} total bytes`)
        const digest = sha256(content)
        await this.writeObject(this.blobPath(digest), content)
        entries.push({ path: name, type: 'file', executable, size: content.byteLength, sha256: digest })
      }
    }

    await walk(source)
    entries.sort((left, right) => left.path.localeCompare(right.path))
    if (kind === 'surface') await validateSurfaceEntries(source, entries)
    if (kind === 'definition') await validateDefinitionEntries(source, entries)
    const manifest: RevisionManifest = { version: 1, kind, entries }
    const canonical = stableStringify(manifest)
    const revision = `sha256:${sha256(canonical)}` as Revision
    await this.writeObject(this.manifestPath(revision), `${canonical}\n`)
    return { revision, manifest: freezeManifest(manifest) }
  }

  async read(revision: Revision): Promise<RevisionManifest> {
    validateRevision(revision)
    let body: string
    try { body = await readFile(this.manifestPath(revision), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkSurfaceError('not-found', `revision '${revision}' was not found`)
      throw error
    }
    let value: unknown
    try { value = JSON.parse(body) }
    catch { throw new WorkSurfaceError('canonical-corrupt', `revision '${revision}' is not valid JSON`) }
    const manifest = validateManifest(value, revision)
    if (`sha256:${sha256(stableStringify(manifest))}` !== revision) throw new WorkSurfaceError('canonical-corrupt', `revision '${revision}' failed its manifest hash`)
    return manifest
  }

  async readFile(revision: Revision, path: string): Promise<Buffer> {
    const normalized = normalizePath(path)
    const manifest = await this.read(revision)
    const entry = manifest.entries.find(candidate => candidate.path === normalized)
    if (entry === undefined) throw new WorkSurfaceError('not-found', `revision '${revision}' has no file '${normalized}'`)
    let content: Buffer
    try { content = await readFile(this.blobPath(entry.sha256)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkSurfaceError('canonical-corrupt', `blob '${entry.sha256}' is missing`)
      throw error
    }
    if (content.byteLength !== entry.size || sha256(content) !== entry.sha256) throw new WorkSurfaceError('canonical-corrupt', `blob '${entry.sha256}' failed verification`)
    return content
  }

  /** Materialize to a new or empty directory. Inputs can request read-only mode. */
  async materialize(revision: Revision, targetPath: string, options: { readonly readOnly?: boolean } = {}): Promise<void> {
    const manifest = await this.read(revision)
    const target = resolve(targetPath)
    try {
      const existing = await readdir(target)
      if (existing.length !== 0) throw new WorkSurfaceError('target-not-empty', `target '${target}' is not empty`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    // Populate privately first; read-only permissions are applied only after
    // every file is durable so nested files remain creatable during checkout.
    await mkdir(target, { recursive: true, mode: 0o700 })
    for (const entry of manifest.entries) {
      const output = resolve(target, entry.path)
      if (!output.startsWith(`${target}${sep}`)) throw new WorkSurfaceError('canonical-corrupt', 'manifest path escapes materialization root')
      await mkdir(dirname(output), { recursive: true, mode: 0o700 })
      const content = await this.readFile(revision, entry.path)
      const mode = options.readOnly === true ? (entry.executable ? 0o500 : 0o400) : (entry.executable ? 0o700 : 0o600)
      await writeFile(output, content, { flag: 'wx', mode })
    }
    if (options.readOnly === true) await makeDirectoriesReadOnly(target)
  }

  /** Remove a store-created checkout, including read-only input materializations. */
  async removeMaterialization(targetPath: string): Promise<void> {
    const target = resolve(targetPath)
    await makeTreeWritable(target)
    await rm(target, { recursive: true, force: true })
  }

  /** Persist an explicit retention root. Pins are facts owned by the Revision store. */
  pin(revision: Revision): Promise<void> {
    return this.serializeMaintenance(async () => {
      await this.read(revision)
      const pins = new Set(await this.readPins())
      pins.add(revision)
      await this.writePins(pins)
    })
  }

  unpin(revision: Revision): Promise<void> {
    return this.serializeMaintenance(async () => {
      validateRevision(revision)
      const pins = new Set(await this.readPins())
      pins.delete(revision)
      await this.writePins(pins)
    })
  }

  listPins(): Promise<readonly Revision[]> {
    return this.readPins()
  }

  /**
   * Mark-and-sweep immutable objects. The age guard is part of correctness:
   * snapshots do not take the maintenance lock, so newly written objects are
   * never eligible during a concurrent collection.
   */
  collect(options: RevisionGcOptions): Promise<RevisionGcResult> {
    return this.serializeMaintenance(async () => {
      await this.init()
      const now = options.now ?? Date.now()
      const minAgeMs = options.minAgeMs ?? 24 * 60 * 60 * 1_000
      if (!Number.isFinite(now) || !Number.isFinite(minAgeMs) || minAgeMs < 0) {
        throw new WorkSurfaceError('invalid-working-copy', 'Revision GC requires a non-negative finite age')
      }
      const cutoff = now - minAgeMs
      const marked = new Set<Revision>([...options.reachable, ...await this.readPins()])
      for (const revision of marked) {
        validateRevision(revision)
        await this.read(revision)
      }

      const manifests = await listRevisionObjects(join(this.root, 'manifests', 'sha256'), true)
      const retained = new Set<Revision>()
      const sweptRevisions: Revision[] = []
      let retainedRecentRevisions = 0
      for (const object of manifests) {
        const revision = `sha256:${object.digest}` as Revision
        if (marked.has(revision) || object.mtimeMs > cutoff) {
          retained.add(revision)
          if (!marked.has(revision)) retainedRecentRevisions += 1
        } else {
          sweptRevisions.push(revision)
        }
      }

      const retainedBlobs = new Set<string>()
      for (const revision of retained) {
        for (const entry of (await this.read(revision)).entries) retainedBlobs.add(entry.sha256)
      }
      for (const revision of sweptRevisions) await unlink(this.manifestPath(revision))

      const sweptBlobs: string[] = []
      for (const object of await listRevisionObjects(join(this.root, 'blobs', 'sha256'), false)) {
        if (!retainedBlobs.has(object.digest) && object.mtimeMs <= cutoff) {
          await unlink(object.path)
          sweptBlobs.push(object.digest)
        }
      }

      let sweptTemporaryFiles = 0
      for (const entry of await readdir(join(this.root, 'tmp'), { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const path = join(this.root, 'tmp', entry.name)
        if ((await stat(path)).mtimeMs <= cutoff) {
          await unlink(path)
          sweptTemporaryFiles += 1
        }
      }
      await removeEmptyFanoutDirectories(join(this.root, 'manifests', 'sha256'))
      await removeEmptyFanoutDirectories(join(this.root, 'blobs', 'sha256'))
      return {
        markedRevisions: marked.size,
        retainedRecentRevisions,
        sweptRevisions: sweptRevisions.sort(),
        sweptBlobs: sweptBlobs.sort(),
        sweptTemporaryFiles,
      }
    })
  }

  private blobPath(digest: string): string {
    return join(this.root, 'blobs', 'sha256', digest.slice(0, 2), digest.slice(2))
  }

  private manifestPath(revision: Revision): string {
    const digest = revision.slice(7)
    return join(this.root, 'manifests', 'sha256', digest.slice(0, 2), `${digest.slice(2)}.json`)
  }

  private async writeObject(path: string, content: string | Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = join(this.root, 'tmp', `${randomUUID()}.part`)
    const temporaryHandle = await open(temporary, 'wx', 0o600)
    try {
      await temporaryHandle.writeFile(content)
      await temporaryHandle.sync()
    } finally {
      await temporaryHandle.close()
    }
    try {
      try {
        await link(temporary, path)
        await syncDirectory(dirname(path))
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await readFile(path)
        const expected = typeof content === 'string' ? Buffer.from(content) : content
        if (!existing.equals(expected)) throw new WorkSurfaceError('canonical-corrupt', `immutable object '${path}' has different bytes`)
      }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private async readPins(): Promise<readonly Revision[]> {
    let value: unknown
    try { value = JSON.parse(await readFile(join(this.root, 'pins.json'), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      if (error instanceof SyntaxError) throw new WorkSurfaceError('canonical-corrupt', 'Revision pins are not valid JSON')
      throw error
    }
    if (!Array.isArray(value)) throw new WorkSurfaceError('canonical-corrupt', 'Revision pins must be an array')
    const pins = value.map(candidate => {
      if (typeof candidate !== 'string') throw new WorkSurfaceError('canonical-corrupt', 'Revision pin is not a string')
      validateRevision(candidate)
      return candidate
    })
    if (new Set(pins).size !== pins.length || pins.some((pin, index) => index > 0 && pins[index - 1]!.localeCompare(pin) >= 0)) {
      throw new WorkSurfaceError('canonical-corrupt', 'Revision pins are not unique and sorted')
    }
    return pins
  }

  private async writePins(pins: ReadonlySet<Revision>): Promise<void> {
    await this.init()
    const temporary = join(this.root, 'tmp', `${randomUUID()}.pins`)
    await writeFile(temporary, `${stableStringify([...pins].sort())}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(this.root, 'pins.json'))
    await syncDirectory(this.root)
  }

  private serializeMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.maintenance.then(operation)
    this.maintenance = result.then(() => undefined, () => undefined)
    return result
  }
}

export function validateSurfaceMarkdown(text: string): void {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let previous = -1
  for (const title of SURFACE_SECTION_TITLES) {
    const index = lines.indexOf(title)
    if (index < 0 || index <= previous) throw new WorkSurfaceError('invalid-working-copy', `surface.md must contain ordered section '${title}'`)
    previous = index
  }
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end < 0) throw new WorkSurfaceError('invalid-working-copy', 'surface.md frontmatter is not closed')
    const frontmatter = lines.slice(1, end).join('\n')
    if (/^(surface[_-]?id|parent|status|session|agent)\s*:/im.test(frontmatter)) {
      throw new WorkSurfaceError('invalid-working-copy', 'surface.md contains runtime-owned identity or status frontmatter')
    }
  }
}

async function validateSurfaceEntries(root: string, entries: readonly RevisionManifestEntry[]): Promise<void> {
  if (!entries.some(entry => entry.path === 'surface.md')) throw new WorkSurfaceError('invalid-working-copy', 'Surface revision requires surface.md')
  validateSurfaceMarkdown(await readFile(join(root, 'surface.md'), 'utf8'))
}

async function validateDefinitionEntries(root: string, entries: readonly RevisionManifestEntry[]): Promise<void> {
  if (!entries.some(entry => entry.path === 'definition.json')) throw new WorkSurfaceError('invalid-working-copy', 'Definition revision requires definition.json')
  let value: unknown
  try { value = JSON.parse(await readFile(join(root, 'definition.json'), 'utf8')) }
  catch { throw new WorkSurfaceError('invalid-definition', 'definition.json is not valid JSON') }
  const stored = defineOrchestration(value)
  for (const subscription of stored.definition.subscriptions) {
    if (!('handler' in subscription.reaction)) continue
    const handlerPath = subscription.reaction.handler.path
    if (!entries.some(entry => entry.path === handlerPath)) throw new WorkSurfaceError('invalid-definition', `handler '${handlerPath}' is absent from Definition revision`)
  }
}

function validateManifest(value: unknown, revision: Revision): RevisionManifest {
  if (!record(value) || value.version !== 1 || !['artifact', 'surface', 'definition'].includes(String(value.kind)) || !Array.isArray(value.entries)) throw corrupt(revision, 'invalid manifest envelope')
  const paths = new Set<string>()
  const entries = value.entries.map((candidate, index): RevisionManifestEntry => {
    if (!record(candidate)) throw corrupt(revision, `entry ${index} is not an object`)
    const path = normalizePath(String(candidate.path))
    if (paths.has(path)) throw corrupt(revision, `duplicate path '${path}'`)
    paths.add(path)
    if (candidate.type !== 'file' || typeof candidate.executable !== 'boolean' || !Number.isSafeInteger(candidate.size) || (candidate.size as number) < 0 || typeof candidate.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.sha256)) throw corrupt(revision, `entry '${path}' is invalid`)
    return { path, type: 'file', executable: candidate.executable, size: candidate.size as number, sha256: candidate.sha256 }
  })
  if (entries.some((entry, index) => index > 0 && entries[index - 1]!.path.localeCompare(entry.path) >= 0)) throw corrupt(revision, 'manifest entries are not strictly sorted')
  return freezeManifest({ version: 1, kind: value.kind as RevisionKind, entries })
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0') || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) throw new WorkSurfaceError('invalid-working-copy', `path '${path}' is not normalized and relative`)
  return normalized
}

function validateRevision(value: string): asserts value is Revision {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new WorkSurfaceError('invalid-id', `invalid revision '${value}'`)
}

async function makeDirectoriesReadOnly(root: string): Promise<void> {
  const directories: string[] = [root]
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const child = join(directory, entry.name)
        directories.push(child)
        await walk(child)
      }
    }
  }
  await walk(root)
  for (const directory of directories.reverse()) await chmod(directory, 0o500)
}

async function makeTreeWritable(root: string): Promise<void> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  await chmod(root, 0o700)
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeTreeWritable(path)
    else await chmod(path, 0o600)
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() }
  catch (error) {
    if (!['EINVAL', 'EBADF', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  } finally { await handle.close() }
}

async function listRevisionObjects(root: string, manifest: boolean): Promise<readonly { digest: string; path: string; mtimeMs: number }[]> {
  const result: { digest: string; path: string; mtimeMs: number }[] = []
  for (const prefix of await readdir(root, { withFileTypes: true })) {
    if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) continue
    const directory = join(root, prefix.name)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const suffix = manifest && entry.name.endsWith('.json') ? entry.name.slice(0, -5) : entry.name
      if (!entry.isFile() || !/^[0-9a-f]{62}$/.test(suffix)) continue
      const path = join(directory, entry.name)
      result.push({ digest: `${prefix.name}${suffix}`, path, mtimeMs: (await stat(path)).mtimeMs })
    }
  }
  return result
}

async function removeEmptyFanoutDirectories(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    if ((await readdir(path)).length === 0) await rmdir(path)
  }
}

function freezeManifest(manifest: RevisionManifest): RevisionManifest {
  for (const entry of manifest.entries) Object.freeze(entry)
  Object.freeze(manifest.entries)
  return Object.freeze(manifest)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function corrupt(revision: Revision, message: string): WorkSurfaceError {
  return new WorkSurfaceError('canonical-corrupt', `revision '${revision}' ${message}`)
}
