import { open, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stableStringify } from './hash.ts'
import { WorkSurfaceError } from './error.ts'
import {
  eventRef,
  subjectKey,
  validateEventDraft,
  validateWorkSurfaceEvent,
  type EventDraft,
  type EventRef,
  type EventSubject,
  type WorkSurfaceEvent,
} from './event-model.ts'

const LOCK_WAIT_MS = 5_000

/** Default append-only JSONL implementation of the public Event Service. */
export class FileEventStore {
  readonly root: string
  private readonly mutations = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(event: WorkSurfaceEvent) => void>()

  constructor(root: string) {
    this.root = resolve(root)
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(join(this.root, 'surfaces'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, 'registrations'), { recursive: true, mode: 0o700 }),
      mkdir(join(this.root, '..', 'locks'), { recursive: true, mode: 0o700 }),
    ])
  }

  /**
   * Append under a subject lock. Same id and canonical intent is idempotent;
   * the same id with different intent is an explicit conflict.
   */
  append(subject: EventSubject, draft: EventDraft): Promise<EventRef> {
    validateEventDraft(draft)
    return this.appendWith(subject, () => draft)
  }

  /** Compute and append one event while holding the subject stream lock. */
  appendWith(subject: EventSubject, create: (stream: readonly WorkSurfaceEvent[]) => EventDraft): Promise<EventRef> {
    const key = subjectKey(subject)
    return this.serialize(key, async () => {
      await this.init()
      const release = await this.acquire(key)
      try {
        const stream = await this.replay(subject)
        const draft = create(stream)
        validateEventDraft(draft)
        const existing = stream.find(event => event.id === draft.id)
        if (existing !== undefined) {
          if (stableStringify(toDraft(existing)) !== stableStringify(normalizeDraft(draft))) {
            throw new WorkSurfaceError('already-exists-conflict', `event id '${draft.id}' already names different content`)
          }
          return eventRef(existing)
        }
        const event: WorkSurfaceEvent = {
          version: 1,
          subject,
          seq: stream.length,
          ...normalizeDraft(draft),
          recordedAt: new Date().toISOString(),
        }
        validateWorkSurfaceEvent(event)
        const path = this.streamPath(subject)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        const handle = await open(path, 'a', 0o600)
        try {
          await handle.write(`${stableStringify(event)}\n`)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await syncDirectory(dirname(path))
        for (const listener of this.listeners) listener(structuredClone(event))
        return eventRef(event)
      } finally {
        await release()
      }
    })
  }

  async replay(subject: EventSubject, fromSeq = 0): Promise<readonly WorkSurfaceEvent[]> {
    subjectKey(subject)
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) throw new WorkSurfaceError('invalid-working-copy', 'fromSeq must be non-negative')
    let content: string
    try {
      content = await readFile(this.streamPath(subject), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const result: WorkSurfaceEvent[] = []
    const lines = content.split('\n')
    if (lines.at(-1) !== '') throw new WorkSurfaceError('canonical-corrupt', `event stream '${subjectKey(subject)}' has a torn final record`)
    for (const [index, line] of lines.slice(0, -1).entries()) {
      let value: unknown
      try { value = JSON.parse(line) }
      catch { throw new WorkSurfaceError('canonical-corrupt', `event stream '${subjectKey(subject)}' record ${index} is invalid JSON`) }
      const event = value as WorkSurfaceEvent
      validateWorkSurfaceEvent(event)
      if (subjectKey(event.subject) !== subjectKey(subject) || event.seq !== index) {
        throw new WorkSurfaceError('canonical-corrupt', `event stream '${subjectKey(subject)}' record ${index} has the wrong subject or seq`)
      }
      if (index >= fromSeq) result.push(event)
    }
    return result
  }

  /** Wakeup only. Consumers must replay after every notification. */
  watch(listener: (event: WorkSurfaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(kind: EventSubject['kind']): Promise<readonly string[]> {
    await this.init()
    const directory = join(this.root, kind === 'surface' ? 'surfaces' : 'registrations')
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => decodeURIComponent(entry.name.slice(0, -'.jsonl'.length)))
      .sort()
  }

  private streamPath(subject: EventSubject): string {
    const safe = encodeURIComponent(subject.id)
    return subject.kind === 'surface'
      ? join(this.root, 'surfaces', `${safe}.jsonl`)
      : join(this.root, 'registrations', `${safe}.jsonl`)
  }

  private lockPath(key: string): string {
    return join(this.root, '..', 'locks', `${encodeURIComponent(key)}.lock`)
  }

  private async acquire(key: string): Promise<() => Promise<void>> {
    const path = this.lockPath(key)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + LOCK_WAIT_MS
    while (true) {
      try {
        const handle = await open(path, 'wx', 0o600)
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`)
        await handle.sync()
        await handle.close()
        return async () => { await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          if (!await lockOwnerIsAlive(path)) {
            await unlink(path)
            continue
          }
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw inspectionError
        }
        if (Date.now() >= deadline) throw new WorkSurfaceError('effect-failed', `timed out acquiring event stream lock '${key}'`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutations.set(key, settled)
    void settled.finally(() => { if (this.mutations.get(key) === settled) this.mutations.delete(key) })
    return result
  }
}

async function lockOwnerIsAlive(path: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(path, 'utf8')).split('\n', 1)[0])
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() }
  catch (error) {
    if (!['EINVAL', 'EBADF', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  } finally { await handle.close() }
}

function normalizeDraft(draft: EventDraft): Required<EventDraft> {
  return {
    id: draft.id,
    name: draft.name,
    payload: structuredClone(draft.payload),
    causes: structuredClone(draft.causes ?? []),
    meta: structuredClone(draft.meta ?? {}),
  }
}

function toDraft(event: WorkSurfaceEvent): Required<EventDraft> {
  return { id: event.id, name: event.name, payload: event.payload, causes: event.causes, meta: event.meta }
}
