import { mkdir, open, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stableStringify } from './hash.ts'
import { WorkSurfaceError } from './error.ts'
import {
  validateRuntimeEventEnvelope,
  validateRuntimeEventRef,
  type AuthorityId,
  type ContractDigest,
  type RuntimeEventEnvelope,
  type RuntimeEventRef,
  type RuntimeProducerKind,
  type RuntimeScope,
} from './runtime-protocol.ts'
import { acquireRuntimeLock, runtimeCorrupt, runtimeInvalid, syncDirectory, validateRuntimeLocalId } from './runtime-store-io.ts'
import type { JsonValue } from './event-model.ts'

export interface RuntimeEventDraft {
  readonly id: string
  readonly type: { readonly scope: RuntimeScope; readonly name: string; readonly contract: ContractDigest }
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly causes: readonly RuntimeEventRef[]
  readonly producer: { readonly kind: RuntimeProducerKind; readonly ref: string }
  readonly operationKey: string
}

/** Authority-qualified Surface Event streams using the target envelope. */
export class RuntimeEventStore {
  readonly root: string
  private readonly mutations = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(event: RuntimeEventEnvelope) => void>()
  constructor(root: string, readonly authority: AuthorityId) { this.root = resolve(root) }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(join(this.root, 'surfaces'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'locks'), { recursive: true, mode: 0o700 }),
    ])
  }

  append(surfaceId: string, draft: RuntimeEventDraft): Promise<RuntimeEventRef> {
    validateRuntimeLocalId(surfaceId, 'Surface id')
    validateDraft(draft, this.authority)
    return this.serialize(surfaceId, async () => {
      await this.init()
      const release = await acquireRuntimeLock(join(this.root, 'locks', `${encodeURIComponent(surfaceId)}.lock`))
      try {
        const stream = await this.replay(surfaceId)
        const existing = stream.find(event => event.id === draft.id)
        if (existing !== undefined) {
          if (stableStringify(toDraft(existing)) !== stableStringify(draft)) throw new WorkSurfaceError('already-exists-conflict', `event id '${draft.id}' already names different content`)
          return runtimeRef(existing)
        }
        const event: RuntimeEventEnvelope = {
          version: 1,
          id: draft.id,
          subject: { authority: this.authority, kind: 'surface', id: surfaceId },
          seq: stream.length,
          type: structuredClone(draft.type),
          payload: structuredClone(draft.payload),
          causes: structuredClone(draft.causes),
          producer: structuredClone(draft.producer),
          operationKey: draft.operationKey,
          recordedAt: new Date().toISOString(),
        }
        validateRuntimeEventEnvelope(event)
        const path = this.streamPath(surfaceId)
        const handle = await open(path, 'a', 0o600)
        try { await handle.write(`${stableStringify(event)}\n`); await handle.sync() } finally { await handle.close() }
        await syncDirectory(dirname(path))
        for (const listener of this.listeners) listener(structuredClone(event))
        return runtimeRef(event)
      } finally { await release() }
    })
  }

  async replay(surfaceId: string, fromSeq = 0): Promise<readonly RuntimeEventEnvelope[]> {
    validateRuntimeLocalId(surfaceId, 'Surface id')
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) throw runtimeInvalid('fromSeq must be non-negative')
    let content: string
    try { content = await readFile(this.streamPath(surfaceId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const lines = content.split('\n')
    if (lines.at(-1) !== '') throw runtimeCorrupt(`Runtime Event stream '${surfaceId}' has a torn final record`)
    const events: RuntimeEventEnvelope[] = []
    for (const [index, line] of lines.slice(0, -1).entries()) {
      let value: unknown
      try { value = JSON.parse(line) } catch { throw runtimeCorrupt(`Runtime Event stream '${surfaceId}' record ${index} is invalid JSON`) }
      validateRuntimeEventEnvelope(value)
      if (value.subject.authority !== this.authority || value.subject.id !== surfaceId || value.seq !== index) throw runtimeCorrupt(`Runtime Event stream '${surfaceId}' record ${index} has the wrong identity`)
      if (index >= fromSeq) events.push(value)
    }
    return events
  }

  async listSurfaces(): Promise<readonly string[]> {
    await this.init()
    return (await readdir(join(this.root, 'surfaces'), { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => decodeURIComponent(entry.name.slice(0, -6))).sort()
  }

  watch(listener: (event: RuntimeEventEnvelope) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private streamPath(surfaceId: string): string { return join(this.root, 'surfaces', `${encodeURIComponent(surfaceId)}.jsonl`) }
  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutations.set(key, settled)
    void settled.finally(() => { if (this.mutations.get(key) === settled) this.mutations.delete(key) })
    return result
  }
}

export function runtimeRef(event: RuntimeEventEnvelope): RuntimeEventRef {
  validateRuntimeEventEnvelope(event)
  return { source: 'worksurface', subject: event.subject, seq: event.seq, id: event.id }
}

function validateDraft(draft: RuntimeEventDraft, authority: AuthorityId): void {
  if (draft === null || typeof draft !== 'object') throw runtimeInvalid('Runtime Event draft must be an object')
  if (typeof draft.id !== 'string' || draft.id.length === 0 || typeof draft.operationKey !== 'string' || draft.operationKey.length === 0) throw runtimeInvalid('Runtime Event draft requires id and operationKey')
  if (draft.type.scope.authority !== authority || !/^sha256:[0-9a-f]{64}$/.test(draft.type.contract) || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(draft.type.name)) throw runtimeInvalid('Runtime Event draft has an invalid type')
  if (draft.payload === null || typeof draft.payload !== 'object' || Array.isArray(draft.payload)) throw runtimeInvalid('Runtime Event payload must be an object')
  if (!Array.isArray(draft.causes)) throw runtimeInvalid('Runtime Event causes must be an array')
  draft.causes.forEach(validateRuntimeEventRef)
  // Keep legacy records readable; new adapters must write `adapter`.
  if (!['surface-session', 'orchestrate', 'runtime', 'adapter', 'dsh-adapter'].includes(String(draft.producer.kind)) || draft.producer.ref.length === 0) throw runtimeInvalid('Runtime Event producer is invalid')
}

function toDraft(event: RuntimeEventEnvelope): RuntimeEventDraft {
  return { id: event.id, type: event.type, payload: event.payload, causes: event.causes, producer: event.producer, operationKey: event.operationKey }
}
