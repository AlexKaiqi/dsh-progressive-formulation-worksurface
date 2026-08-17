import { WorkSurfaceError } from './error.ts'
import { BlockId, SurfaceId } from './ids.ts'
import { parseBlockReferences } from './markdown.ts'
import type { WorkSurfaceStore } from './store.ts'
import type { BlockRef, Revision, WorkSurfaceProjectionSnapshot } from './types.ts'

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

/** Deterministic direct-reference Projection compiler over canonical file revisions. */
export class ProjectionCompiler {
  constructor(private readonly store: WorkSurfaceStore) {}

  /**
   * Compile the current or pinned Surface using current revisions for cross-Surface references.
   * @param options - Surface identity, optional revision, profile, and budget.
   * @returns The rendered Projection and its exact revision pins.
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
    return renderProjection(snapshot.surfaceDocument, surface, snapshot.revision, blocks, options.profile, options.tokenBudget)
  }

  /**
   * Rebuild a Projection with an explicit revision for every directly referenced Block.
   * @param options - Surface revision and ordered Block revision pins.
   * @returns The exactly rebuilt Projection.
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
    return renderProjection(snapshot.surfaceDocument, surface, snapshot.revision, blocks, options.profile, options.tokenBudget)
  }
}

function validateProjectionOptions(options: ProjectionOptions): void {
  if (!Number.isSafeInteger(options.tokenBudget) || options.tokenBudget <= 0) {
    throw new WorkSurfaceError('invalid-working-copy', 'Projection token budget must be a positive safe integer')
  }
  if (options.profile.trim() === '') throw new WorkSurfaceError('unsupported-profile', 'Projection profile must not be blank')
}

function renderProjection(
  surfaceDocument: string,
  surface: ReturnType<typeof SurfaceId>,
  surfaceRevision: Revision,
  blocks: readonly ResolvedBlock[],
  profile: string,
  tokenBudget: number,
): WorkSurfaceProjectionSnapshot {
  const maxCharacters = tokenBudget * 4
  let remaining = Math.max(0, maxCharacters - surfaceDocument.length)
  let cursor = 0
  let rendered = ''
  const referenceToken = /\[\[block:([^\]]+)\]\]/g
  let index = 0
  let match: RegExpExecArray | null
  while ((match = referenceToken.exec(surfaceDocument)) !== null) {
    rendered += surfaceDocument.slice(cursor, match.index + match[0].length)
    cursor = match.index + match[0].length
    const block = blocks[index++] as ResolvedBlock
    const header = `\n\n<!-- worksurface:block ${block.ref.surface}/${block.ref.block}@${block.ref.revision} -->\n`
    const footer = `\n<!-- /worksurface:block ${block.ref.surface}/${block.ref.block} -->`
    const wrapperCost = header.length + footer.length
    const available = Math.max(0, remaining - wrapperCost)
    const body = truncateBlock(block.content, available, block.ref)
    rendered += header + body + footer
    remaining = Math.max(0, remaining - wrapperCost - body.length)
  }
  rendered += surfaceDocument.slice(cursor)
  return {
    surfaceId: surface,
    surfaceRevision,
    blockRevisions: blocks.map(block => block.ref),
    renderedContent: rendered,
    profile,
    createdAt: new Date().toISOString(),
  }
}

function truncateBlock(content: string, available: number, ref: BlockRef): string {
  if (content.length <= available) return content
  const notice = `\n\n[truncated by Projection budget; read [[block:${ref.surface}/${ref.block}]] at ${ref.revision}]`
  if (available <= notice.length) return notice.slice(0, available)
  return `${content.slice(0, available - notice.length)}${notice}`
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
