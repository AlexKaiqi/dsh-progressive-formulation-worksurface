import { createHash } from 'node:crypto'
import type { Revision } from './types.ts'

/**
 * Return a lowercase SHA-256 digest.
 * @param value - Text or bytes to hash.
 * @returns The hexadecimal digest without an algorithm prefix.
 */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Return a deterministic JSON encoding with lexicographically sorted object keys.
 * @param value - JSON-compatible value to encode.
 * @returns The stable JSON representation.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]))
  }
  return value
}

/**
 * Hash a full Surface snapshot independently of timestamps and filesystem order.
 * @param surfaceDocument - Canonical Surface Markdown bytes.
 * @param blocks - Block contents keyed by Block id.
 * @returns The content-addressed Surface revision.
 */
export function hashSurfaceContent(surfaceDocument: string, blocks: ReadonlyMap<string, string>): Revision {
  const hash = createHash('sha256')
  const entries = [['surface.md', surfaceDocument] as const, ...[...blocks.entries()]
    .map(([id, content]) => [`blocks/${id}.md`, content] as const)
    .sort(([left], [right]) => left.localeCompare(right))]
  for (const [path, content] of entries) {
    const bytes = Buffer.from(content, 'utf8')
    hash.update(path)
    hash.update('\0')
    hash.update(String(bytes.byteLength))
    hash.update('\0')
    hash.update(bytes)
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}
