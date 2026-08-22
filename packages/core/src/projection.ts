import { WorkSurfaceError } from './error.ts'
import { stableStringify } from './hash.ts'
import { BlockId, SurfaceId } from './ids.ts'
import { parseBlockReferences } from './markdown.ts'
import type { WorkSurfaceStore } from './store.ts'
import type {
  BlockRef,
  OmittedWorkSurfaceProjectionFile,
  Revision,
  SurfaceSnapshot,
  WorkSurfaceProjectionFile,
  WorkSurfaceProjectionSnapshot,
} from './types.ts'

interface ProjectionOptions {
  readonly surface: string
  readonly profile: string
  readonly tokenBudget: number
  readonly revision?: Revision
}

interface PinnedProjectionOptions extends ProjectionOptions {
  readonly revision: Revision
  readonly blockRevisions: readonly BlockRef[]
}

interface ResolvedBlock {
  readonly ref: BlockRef
  readonly content: string
}

/** Deterministic Projection content, cached by its resolved revision pins. */
interface ProjectedFiles {
  readonly files: readonly WorkSurfaceProjectionFile[]
  readonly omittedFiles: readonly OmittedWorkSurfaceProjectionFile[]
  readonly blockRevisions: readonly BlockRef[]
  readonly budgetExceeded: boolean
}

/** Bounded in-memory cache sizing for the Projection compiler. */
export interface ProjectionCompilerOptions {
  /** Maximum verified immutable Surface snapshots retained. */
  readonly maxSnapshots?: number
  /** Maximum deterministic Projection results retained. */
  readonly maxProjections?: number
}

const CHARACTERS_PER_TOKEN = 4
const MANIFEST_BASE_CHARACTERS = 256
const MANIFEST_BLOCK_CHARACTERS = 128
const FILE_WRAPPER_CHARACTERS = 160

/**
 * Deterministic direct-reference Projection compiler over canonical file revisions.
 *
 * Verified immutable snapshots and compiled Projections are memoized per resolved
 * revision pin. Reuse is safe because revision content is content-addressed: a
 * cached snapshot is the exact immutable revision it names, and a cached
 * Projection is a pure function of its pins, profile, and budget. The observation
 * timestamp is re-stamped on every call so freshness semantics are unchanged.
 */
export class ProjectionCompiler {
  private readonly snapshotMemo = new Map<string, SurfaceSnapshot>()
  private readonly projectionMemo = new Map<string, ProjectedFiles>()
  private readonly maxSnapshots: number
  private readonly maxProjections: number

  constructor(
    private readonly store: WorkSurfaceStore,
    options: ProjectionCompilerOptions = {},
  ) {
    this.maxSnapshots = options.maxSnapshots ?? 128
    this.maxProjections = options.maxProjections ?? 128
  }

  /**
   * Compile the current or pinned Surface using current revisions for cross-Surface references.
   * @param options - Surface identity, optional revision, profile, and budget.
   * @returns Complete projected files and their exact revision pins.
   */
  async compile(options: ProjectionOptions): Promise<WorkSurfaceProjectionSnapshot> {
    validateProjectionOptions(options)
    const surface = SurfaceId(options.surface)
    const snapshot = await this.readSnapshot(surface, options.revision)
    const blocks: ResolvedBlock[] = []
    for (const reference of parseBlockReferences(snapshot.surfaceDocument)) {
      const revision = reference.surface === surface
        ? snapshot.revision
        : (await this.store.readHead(reference.surface)).revision
      const ref: BlockRef = { ...reference, revision }
      blocks.push({ ref, content: await this.readBlockContent(ref) })
    }
    return this.project(snapshot, blocks, options.profile, options.tokenBudget)
  }

  /**
   * Rebuild a Projection with an explicit revision for every directly referenced Block.
   * @param options - Surface revision and ordered Block revision pins.
   * @returns The exactly rebuilt file Projection.
   */
  async compilePinned(options: PinnedProjectionOptions): Promise<WorkSurfaceProjectionSnapshot> {
    validateProjectionOptions(options)
    const surface = SurfaceId(options.surface)
    const snapshot = await this.readSnapshot(surface, options.revision)
    const references = parseBlockReferences(snapshot.surfaceDocument)
    if (references.length !== options.blockRevisions.length) {
      throw new WorkSurfaceError('invalid-reference', 'pinned Block revisions do not match the Surface reference count')
    }
    const blocks: ResolvedBlock[] = []
    for (const [index, reference] of references.entries()) {
      const pinned = options.blockRevisions[index] as BlockRef
      if (pinned.surface !== reference.surface || pinned.block !== reference.block) {
        throw new WorkSurfaceError('invalid-reference', `pinned Block revision at index ${index} does not match Surface order`)
      }
      blocks.push({ ref: pinned, content: await this.readBlockContent(pinned) })
    }
    return this.project(snapshot, blocks, options.profile, options.tokenBudget)
  }

  /** Compile or reuse one deterministic Projection, re-stamping its observation time. */
  private async project(
    snapshot: SurfaceSnapshot,
    blocks: readonly ResolvedBlock[],
    profile: string,
    tokenBudget: number,
  ): Promise<WorkSurfaceProjectionSnapshot> {
    const blockRevisions = blocks.map(block => block.ref)
    const key = stableStringify({ surface: snapshot.surface, revision: snapshot.revision, profile, tokenBudget, blockRevisions })
    let projected = this.projectionMemo.get(key)
    if (projected === undefined) {
      projected = projectFiles(snapshot.surfaceDocument, snapshot.surface, snapshot.revision, blocks, tokenBudget)
      remember(this.projectionMemo, this.maxProjections, key, projected)
    }
    return {
      surfaceId: snapshot.surface,
      surfaceRevision: snapshot.revision,
      blockRevisions,
      files: projected.files,
      omittedFiles: projected.omittedFiles,
      budgetExceeded: projected.budgetExceeded,
      profile,
      createdAt: new Date().toISOString(),
    }
  }

  /** Read a verified immutable snapshot, memoized by its content revision. */
  private async readSnapshot(surface: ReturnType<typeof SurfaceId>, revision?: Revision): Promise<SurfaceSnapshot> {
    const resolved = revision ?? (await this.store.readHead(surface)).revision
    const key = `${surface}\0${resolved}`
    const memoized = this.snapshotMemo.get(key)
    if (memoized !== undefined) return memoized
    const snapshot = await this.store.readSnapshot(surface, resolved)
    remember(this.snapshotMemo, this.maxSnapshots, key, snapshot)
    return snapshot
  }

  /** Read one revision-pinned Block from memoized verified snapshot content. */
  private async readBlockContent(ref: BlockRef): Promise<string> {
    const snapshot = await this.readSnapshot(ref.surface, ref.revision)
    const block = snapshot.blocks.get(BlockId(ref.block))
    if (block === undefined) {
      throw new WorkSurfaceError('dangling-reference', `Block '${ref.surface}/${ref.block}' is absent at '${ref.revision}'`, { ref })
    }
    return block
  }
}

/** Insert one entry and evict the least recently used entry beyond the cap. */
function remember<K, V>(memo: Map<K, V>, max: number, key: K, value: V): void {
  if (memo.has(key)) memo.delete(key)
  memo.set(key, value)
  while (memo.size > max) {
    const oldest = memo.keys().next().value
    if (oldest === undefined) break
    memo.delete(oldest)
  }
}

function validateProjectionOptions(options: ProjectionOptions): void {
  if (!Number.isSafeInteger(options.tokenBudget) || options.tokenBudget <= 0) {
    throw new WorkSurfaceError('invalid-working-copy', 'Projection token budget must be a positive safe integer')
  }
  if (options.profile.trim() === '') throw new WorkSurfaceError('unsupported-profile', 'Projection profile must not be blank')
}

function projectFiles(
  surfaceDocument: string,
  surface: ReturnType<typeof SurfaceId>,
  surfaceRevision: Revision,
  blocks: readonly ResolvedBlock[],
  tokenBudget: number,
): ProjectedFiles {
  const maxCharacters = tokenBudget * CHARACTERS_PER_TOKEN
  const surfaceFile: WorkSurfaceProjectionFile = {
    kind: 'surface',
    surfaceId: surface,
    revision: surfaceRevision,
    relativePath: 'surface.md',
    content: surfaceDocument,
    writable: true,
  }
  const files: WorkSurfaceProjectionFile[] = [surfaceFile]
  const omittedFiles: OmittedWorkSurfaceProjectionFile[] = []
  let usedCharacters = MANIFEST_BASE_CHARACTERS
    + blocks.length * MANIFEST_BLOCK_CHARACTERS
    + projectedFileCharacters(surfaceFile)
  const budgetExceeded = usedCharacters > maxCharacters
  const included = new Set<string>()

  for (const block of blocks) {
    const key = `${block.ref.surface}\0${block.ref.block}\0${block.ref.revision}`
    if (included.has(key)) continue
    included.add(key)

    const relativePath = `blocks/${block.ref.block}.md`
    const writable = block.ref.surface === surface
    const file: WorkSurfaceProjectionFile = {
      kind: 'block',
      surfaceId: block.ref.surface,
      blockId: block.ref.block,
      revision: block.ref.revision,
      relativePath,
      content: block.content,
      writable,
    }
    const fileCharacters = projectedFileCharacters(file)
    if (usedCharacters + fileCharacters <= maxCharacters) {
      files.push(file)
      usedCharacters += fileCharacters
      continue
    }
    omittedFiles.push({
      kind: 'block',
      surfaceId: block.ref.surface,
      blockId: block.ref.block,
      revision: block.ref.revision,
      relativePath,
      writable,
      reason: 'token-budget',
    })
  }

  return {
    files,
    omittedFiles,
    blockRevisions: blocks.map(block => block.ref),
    budgetExceeded,
  }
}

function projectedFileCharacters(file: WorkSurfaceProjectionFile): number {
  return file.content.length + file.relativePath.length + FILE_WRAPPER_CHARACTERS
}

/**
 * Create a validated BlockRef from JSON-compatible values.
 * @param surface - Surface id to validate.
 * @param block - Block id to validate.
 * @param revision - Immutable revision containing the Block.
 * @returns The validated revision-pinned reference.
 */
export function createBlockRef(surface: string, block: string, revision: Revision): BlockRef {
  return { surface: SurfaceId(surface), block: BlockId(block), revision }
}
