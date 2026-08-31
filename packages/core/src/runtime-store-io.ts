import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { WorkSurfaceError } from './error.ts'
import { stableStringify } from './hash.ts'
import type { ContractDigest } from './runtime-protocol.ts'

const LOCK_WAIT_MS = 5_000

export async function readRuntimeJson(path: string, label: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkSurfaceError('not-found', `${label} does not exist`)
    if (error instanceof SyntaxError) throw runtimeCorrupt(`${label} is invalid JSON`)
    throw error
  }
}

export async function durableCreate(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(`${stableStringify(value)}\n`); await handle.sync() } finally { await handle.close() }
  try { await link(temporary, path); await syncDirectory(dirname(path)) } finally { await unlink(temporary).catch(() => undefined) }
}

export async function acquireRuntimeLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + LOCK_WAIT_MS
  while (true) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n${Date.now()}\n${randomUUID()}\n`)
      await handle.sync()
      await handle.close()
      return async () => { await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const info = await stat(path)
        if (Date.now() - info.mtimeMs > LOCK_WAIT_MS * 4) { await unlink(path); continue }
      } catch (inspection) {
        if ((inspection as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw inspection
      }
      if (Date.now() >= deadline) throw new WorkSurfaceError('effect-failed', `timed out acquiring Runtime lock '${path}'`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    }
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() }
  catch (error) { if (!['EINVAL', 'EBADF', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
  finally { await handle.close() }
}

export function validateRuntimeDigest(value: string): asserts value is ContractDigest {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw runtimeInvalid('invalid digest')
}

export function validateRuntimeLocalId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw runtimeInvalid(`${label} is invalid`)
}

export function runtimeInvalid(message: string): WorkSurfaceError { return new WorkSurfaceError('invalid-working-copy', message) }
export function runtimeCorrupt(message: string): WorkSurfaceError { return new WorkSurfaceError('canonical-corrupt', message) }
