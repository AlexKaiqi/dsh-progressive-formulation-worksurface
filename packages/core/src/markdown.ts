import { parse, stringify } from 'yaml'
import { WorkSurfaceError } from './error.ts'
import { BlockId, SurfaceId } from './ids.ts'
import type { BlockEnvelope, BlockRef, SurfaceEnvelope, SurfaceId as SurfaceIdType } from './types.ts'

interface FrontMatter {
  readonly data: Record<string, unknown>
  readonly body: string
}

/**
 * Parse a required YAML frontmatter envelope without changing Markdown bytes.
 * @param content - Complete Markdown document.
 * @param label - Human-readable document label for diagnostics.
 * @returns Parsed metadata and unchanged body.
 */
export function parseFrontMatter(content: string, label: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new WorkSurfaceError('invalid-markdown-envelope', `${label} must start with YAML frontmatter`)
  let parsed: unknown
  try {
    parsed = parse(match[1] as string)
  } catch (error) {
    throw new WorkSurfaceError('invalid-markdown-envelope', `${label} has invalid YAML frontmatter`, {
      cause: String(error),
    })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorkSurfaceError('invalid-markdown-envelope', `${label} frontmatter must be a mapping`)
  }
  return { data: parsed as Record<string, unknown>, body: content.slice(match[0].length) }
}

/**
 * Parse and validate a Surface envelope.
 * @param content - Complete Surface Markdown document.
 * @returns The validated runtime-owned envelope.
 */
export function parseSurfaceDocument(content: string): SurfaceEnvelope {
  const { data } = parseFrontMatter(content, 'surface.md')
  if (typeof data.surface_id !== 'string') {
    throw new WorkSurfaceError('invalid-markdown-envelope', 'surface.md requires string surface_id')
  }
  if (data.parent !== null && typeof data.parent !== 'string') {
    throw new WorkSurfaceError('invalid-markdown-envelope', 'surface.md parent must be a Surface id or null')
  }
  if (typeof data.status !== 'string' || data.status.trim() === '') {
    throw new WorkSurfaceError('invalid-markdown-envelope', 'surface.md requires non-blank status')
  }
  return {
    surfaceId: SurfaceId(data.surface_id),
    parent: data.parent === null ? null : SurfaceId(data.parent),
    status: data.status,
  }
}

/**
 * Parse and validate a Block envelope.
 * @param content - Complete Block Markdown document.
 * @param label - Human-readable Block label for diagnostics.
 * @returns The validated runtime-owned envelope.
 */
export function parseBlockDocument(content: string, label = 'Block'): BlockEnvelope {
  const { data } = parseFrontMatter(content, label)
  if (typeof data.block_id !== 'string' || typeof data.surface_id !== 'string') {
    throw new WorkSurfaceError('invalid-markdown-envelope', `${label} requires string block_id and surface_id`)
  }
  if (typeof data.kind !== 'string' || data.kind.trim() === '' || typeof data.status !== 'string' || data.status.trim() === '') {
    throw new WorkSurfaceError('invalid-markdown-envelope', `${label} requires non-blank kind and status`)
  }
  if (data.derived_from !== undefined && !Array.isArray(data.derived_from)) {
    throw new WorkSurfaceError('invalid-markdown-envelope', `${label} derived_from must be an array when present`)
  }
  return {
    blockId: BlockId(data.block_id),
    surfaceId: SurfaceId(data.surface_id),
    kind: data.kind,
    status: data.status,
    derivedFrom: data.derived_from ?? [],
  }
}

/**
 * Replace or add the runtime-owned Surface envelope while preserving the Markdown body.
 * @param content - Reusable Surface template.
 * @param surface - Assigned Surface id.
 * @param parent - Assigned parent Surface, or null for a root.
 * @returns Instantiated Surface Markdown.
 */
export function instantiateSurfaceDocument(content: string, surface: SurfaceIdType, parent: SurfaceIdType | null): string {
  let body = content
  let data: Record<string, unknown> = {}
  if (/^---\r?\n/.test(content)) {
    const frontMatter = parseFrontMatter(content, 'surface.md template')
    data = frontMatter.data
    body = frontMatter.body
  }
  const envelope = {
    ...data,
    surface_id: surface,
    parent,
    status: typeof data.status === 'string' && data.status.trim() !== '' ? data.status : 'active',
  }
  return `---\n${stringify(envelope).trimEnd()}\n---\n${body}`
}

/**
 * Replace the runtime-owned ids in a reusable Block template.
 * @param content - Reusable Block template.
 * @param surface - Assigned Surface id.
 * @param block - Assigned Block id.
 * @returns Instantiated Block Markdown.
 */
export function instantiateBlockDocument(content: string, surface: SurfaceIdType, block: string): string {
  const frontMatter = parseFrontMatter(content, `Block template '${block}'`)
  const envelope = {
    ...frontMatter.data,
    block_id: BlockId(block),
    surface_id: surface,
  }
  return `---\n${stringify(envelope).trimEnd()}\n---\n${frontMatter.body}`
}

/**
 * Return Block references in exact appearance order, rejecting malformed reference syntax.
 * @param content - Markdown text to scan.
 * @returns Validated unpinned Block references.
 */
export function parseBlockReferences(content: string): Array<Omit<BlockRef, 'revision'>> {
  const references: Array<Omit<BlockRef, 'revision'>> = []
  const starts = content.match(/\[\[block:/g)?.length ?? 0
  const token = /\[\[block:([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = token.exec(content)) !== null) {
    const raw = match[1] as string
    const parts = raw.split('/')
    const surface = parts[0]
    const block = parts[1]
    if (parts.length !== 2 || surface === undefined || block === undefined) {
      throw new WorkSurfaceError('invalid-reference', `invalid Block reference '[[block:${raw}]]'`, { reference: raw })
    }
    references.push({ surface: SurfaceId(surface), block: BlockId(block) })
  }
  if (starts !== references.length) {
    throw new WorkSurfaceError('invalid-reference', 'unterminated or malformed Block reference')
  }
  return references
}
