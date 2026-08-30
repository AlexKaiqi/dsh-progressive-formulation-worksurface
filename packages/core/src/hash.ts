import { createHash } from 'node:crypto'

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
