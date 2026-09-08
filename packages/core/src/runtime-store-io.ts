import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
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

interface LockOwner { readonly pid: number; readonly token: string; readonly ticket: number }

/**
 * Process-owned bakery lock. Unique owner files avoid compare/unlink races:
 * a waiter never removes a live owner's file, and release touches only its own UUID.
 * The doorway and ticket are atomically published, so a crash has no half-owner.
 */
export async function acquireRuntimeLock(path: string): Promise<() => Promise<void>> {
  const directory = `${path}.owners`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // Old lease files must not coexist with the new protocol during an upgrade.
  try {
    const legacy = await readFile(path, 'utf8')
    const pid = Number(legacy.split('\n')[0])
    if (!Number.isSafeInteger(pid) || pid <= 0 || processAlive(pid)) throw new WorkSurfaceError('effect-failed', `legacy Runtime lock '${path}' is still owned; stop its runtime before upgrading`)
    // Retain the dead legacy file as evidence. It never participates in the new owner namespace.
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const token = randomUUID()
  const choosing = `${directory}/${token}.choosing`
  const ticketPath = `${directory}/${token}.ticket`
  const release = async () => {
    await Promise.all([choosing, ticketPath].map(file => unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })))
  }
  const deadline = Date.now() + LOCK_WAIT_MS
  try {
    await durableCreate(choosing, { pid: process.pid, token, ticket: 0 })
    const previous = await lockOwners(directory)
    const ticket = Math.max(0, ...previous.filter(owner => owner.phase === 'ticket').map(owner => owner.ticket)) + 1
    if (!Number.isSafeInteger(ticket)) throw runtimeCorrupt('Runtime lock ticket overflow')
    await durableCreate(ticketPath, { pid: process.pid, token, ticket })
    await unlink(choosing)
    while (true) {
      const owners = await lockOwners(directory)
      const blocked = owners.some(owner => owner.token !== token && (owner.phase === 'choosing' || owner.ticket < ticket || (owner.ticket === ticket && owner.token < token)))
      if (!blocked) return release
      if (Date.now() >= deadline) throw new WorkSurfaceError('effect-failed', `timed out acquiring Runtime lock '${path}'`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    }
  } catch (error) { await release(); throw error }
}

async function lockOwners(directory: string): Promise<readonly (LockOwner & { readonly phase: 'choosing' | 'ticket' })[]> {
  const owners: (LockOwner & { phase: 'choosing' | 'ticket' })[] = []
  const tokens = new Set((await readdir(directory)).flatMap(name => {
    const match = /^([0-9a-f-]{36})\.(choosing|ticket)$/.exec(name)
    return match === null ? [] : [match[1]!]
  }))
  for (const token of tokens) {
    // Read the doorway before its ticket, even if readdir observed only the doorway.
    // Otherwise a chooser transitioning between listing and reading could disappear.
    for (const phase of ['choosing', 'ticket'] as const) {
      const file = `${directory}/${token}.${phase}`
      let owner: LockOwner
      try { owner = JSON.parse(await readFile(file, 'utf8')) as LockOwner }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw runtimeCorrupt('Runtime lock owner is unreadable') }
      if (owner === null || typeof owner !== 'object' || owner.token !== token || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isSafeInteger(owner.ticket) || owner.ticket < 0 || (phase === 'ticket' && owner.ticket === 0)) throw runtimeCorrupt('Runtime lock owner has an invalid shape')
      if (!processAlive(owner.pid)) {
        // Each name belongs to one attempt forever; no replacement can be deleted here.
        await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
        continue
      }
      owners.push({ ...owner, phase })
      if (phase === 'choosing') break
    }
  }
  return owners
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; if ((error as NodeJS.ErrnoException).code === 'EPERM') return true; throw error }
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
