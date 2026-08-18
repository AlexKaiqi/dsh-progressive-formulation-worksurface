import { WorkSurfaceError } from '@pf-worksurface/core'
import type { Revision } from '@pf-worksurface/core'

export function stringParam(params: Readonly<Record<string, unknown>>, name: string): string {
  return stringValue(params[name], name)
}

export function optionalString(params: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = params[name]
  return value === undefined ? undefined : stringValue(value, name)
}

export function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new WorkSurfaceError('invalid-working-copy', `${name} must be a non-empty string`)
  return value
}

export function revisionValue(value: unknown, name: string): Revision {
  const revision = stringValue(value, name)
  if (/^sha256:[0-9a-f]{64}$/.test(revision) === false) throw new WorkSurfaceError('invalid-reference', `${name} must be a sha256 revision`)
  return revision as Revision
}

export function numberParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const value = params[name]
  if (Number.isSafeInteger(value) === false || (value as number) <= 0) throw new WorkSurfaceError('invalid-working-copy', `${name} must be a positive integer`)
  return value as number
}

export function safeKey(key: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key) === false) throw new WorkSurfaceError('invalid-id', 'effect key is not filesystem-safe')
  return key
}
