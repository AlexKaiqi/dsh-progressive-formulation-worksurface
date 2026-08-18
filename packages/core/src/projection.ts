import { WorkSurfaceError } from './error.ts'
import { BlockId, SurfaceId } from './ids.ts'
import { parseBlockReferences } from './markdown.ts'
import type { WorkSurfaceStore } from './store.ts'
import type {
  BlockRef,
  OmittedWorkSurfaceProjectionFile,
  Revision,
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

const CHARACTERS_PER_TOKEN = 4
const MANIFEST_BASE_CHARACTERS = 256
const MANIFEST_BLOCK_CHARACTERS = 128
const FILE_WRAPPER_CHARACTERS = 160

/** Deterministic direct-reference Projection compiler over canonical file revisions. */
export class ProjectionCompiler {
  constructor(private readonly store: WorkSurfaceStore) {}

  /**
   * Compile the current or pinned Surface using current revisions for cross-Surface references.
   * @param options - Surface identity, optional revision, profile, and budget.
   * @returns Complete projected files and their exact revision pins.
   */
  async compile(options: ProjectionOptions): Promise<WorkSurfaceProjectionSnapshot> {
    validateProjectionOptions(options)
    const surface = SurfaceId(options.surface)
    const snapshot = await this.store.readSnapshot(surface, options.revision)
    const blocks: ResolvedBlock[] = []
    for (const reference of parseBlockReferences(snapshot.surfaceDocument)) {
      const revision = reference.surface === surface
        ? snapshot.revision
        : (await this.store.readHead(reference.surface)).revision
      const ref: BlockRef = { ...reference, revision }
      blocks.push({ ref, content: await this.store.readBlock(ref) })
    }
    return projectFiles(snapshot.surfaceDocument, surface, snapshot.revision, blocks, options.profile, options.tokenBudget)
  }

  /**
   * Rebuild a Projection with an explicit revision for every directly referenced Block.
   * @param options - Surface revision and ordered Block revision pins.
   * @returns The exactly rebuilt file Projection.
   */
  async compilePinned(options: PinnedProjectionOptions): Promise<WorkSurfaceProjectionSnapshot> {
    validateProjectionOptions(options)
    const surface = SurfaceId(options.surface)
    const snapshot = await this.store.readSnapshot(surface, options.revision)
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
      blocks.push({ ref: pinned, content: await this.store.readBlock(pinned) })
    }
    return projectFiles(snapshot.surfaceDocument, surface, snapshot.revision, blocks, options.profile, options.tokenBudget)
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
  profile: string,
  tokenBudget: number,
): WorkSurfaceProjectionSnapshot {
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
    surfaceId: surface,
    surfaceRevision,
    blockRevisions: blocks.map(block => block.ref),
    files,
    omittedFiles,
    budgetExceeded,
    profile,
    createdAt: new Date().toISOString(),
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
