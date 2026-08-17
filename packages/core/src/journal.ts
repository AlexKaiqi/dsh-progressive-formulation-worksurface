import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { asWorkSurfaceError, WorkSurfaceError } from './error.ts'
import { sha256, stableStringify } from './hash.ts'
import { withRecoverableLock } from './lock.ts'
import type { EffectRecord, FaultInjector } from './types.ts'

interface RunEffectOptions<T> {
  readonly attemptId: string
  readonly key: string
  readonly type: string
  readonly request: unknown
  readonly retry?: boolean
  readonly reconcile: () => Promise<T | undefined>
  readonly execute: () => Promise<T>
}

/** Durable idempotency journal whose started records reconcile against canonical commit metadata. */
export class EffectJournal {
  constructor(private readonly root: string, private readonly faultInjector?: FaultInjector) {}

  /**
   * Run or replay one named effect.
   * @param options - Effect identity, request, execution, and reconciliation hooks.
   * @returns The executed, replayed, or reconciled result.
   */
  async run<T>(options: RunEffectOptions<T>): Promise<T> {
    const attempt = safeComponent(options.attemptId, 'attempt id')
    if (options.key.trim() === '') throw new WorkSurfaceError('invalid-id', 'idempotency key must not be blank')
    const requestHash = sha256(stableStringify({ type: options.type, request: options.request }))
    const directory = join(this.root, attempt)
    const path = join(directory, `${sha256(options.key)}.json`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return withRecoverableLock(`${path}.lock`, async () => {
      const existing = await readRecord(path)
      if (existing && (existing.key !== options.key || existing.requestHash !== requestHash || existing.type !== options.type)) {
        throw new WorkSurfaceError('idempotency-key-conflict', `idempotency key '${options.key}' was used with different parameters`, {
          attemptId: options.attemptId,
          key: options.key,
        })
      }
      if (existing?.status === 'completed') return existing.result as T
      if (existing?.status === 'failed' && !options.retry) {
        throw new WorkSurfaceError('effect-failed', existing.error?.message ?? 'previous effect attempt failed', {
          originalCode: existing.error?.code ?? 'effect-failed',
        })
      }
      if (existing?.status === 'started' || existing?.status === 'interrupted') {
        const reconciled = await options.reconcile()
        if (reconciled !== undefined) {
          await writeRecord(path, { ...baseRecord(options, requestHash), status: 'completed', result: reconciled })
          return reconciled
        }
        await writeRecord(path, { ...baseRecord(options, requestHash), status: 'interrupted' })
      }
      await writeRecord(path, { ...baseRecord(options, requestHash), status: 'started' })
      try {
        const result = await options.execute()
        await writeRecord(path, { ...baseRecord(options, requestHash), status: 'completed', result })
        await this.faultInjector?.('journal-completed')
        return result
      } catch (error) {
        const stable = asWorkSurfaceError(error)
        await writeRecord(path, {
          ...baseRecord(options, requestHash),
          status: 'failed',
          error: { code: stable.code, message: stable.message, details: stable.details },
        })
        throw stable
      }
    })
  }
}

function baseRecord<T>(options: RunEffectOptions<T>, requestHash: string): Omit<EffectRecord, 'status'> {
  return { attemptId: options.attemptId, key: options.key, type: options.type, requestHash }
}

function safeComponent(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new WorkSurfaceError('invalid-id', `${label} contains unsafe path characters`, { value })
  }
  return value
}

async function readRecord(path: string): Promise<EffectRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as EffectRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    throw new WorkSurfaceError('canonical-corrupt', `cannot read effect journal record ${path}`, {
      cause: String(error),
    })
  }
}

async function writeRecord(path: string, record: EffectRecord): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
