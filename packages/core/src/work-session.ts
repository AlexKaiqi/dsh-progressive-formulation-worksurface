import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { WorkSurfaceError } from './error.ts'
import { sha256, stableStringify } from './hash.ts'
import { SurfaceId } from './ids.ts'
import { withRecoverableLock } from './lock.ts'
import type {
  LegacyEventType,
  Revision,
  SurfaceId as SurfaceIdType,
  WorkSessionEvent,
  WorkSessionEventDataMap,
  WorkSessionEventType,
  WorkSessionHeader,
  WorkSessionSnapshot,
} from './types.ts'

interface AppendWorkSessionEventOptions<T extends WorkSessionEventType> {
  readonly surface: string
  readonly type: T
  readonly data: WorkSessionEventDataMap[T]
  readonly idempotencyKey: string
  readonly causationId?: string
  readonly correlationId?: string
  readonly attemptId?: string
}

interface WorkSessionHead {
  readonly seq: number
  readonly eventId: string
}

const EVENT_FILE = /^(\d{12})\.json$/
const EVENT_TYPES = new Set<WorkSessionEventType>([
  'surface/created',
  'surface/revision-published',
  'orchestrator/defined',
  'orchestrator/run-started',
  'orchestrator/run-completed',
  'orchestrator/run-interrupted',
  'orchestrator/run-failed',
])

/**
 * Facts that moved out of the Work Session stream: child existence is owned by
 * delegation records aligned with the DSH Session tree, and Agent/Session
 * attachment is a write-once delegation record per Surface. Streams that still
 * contain them predate that move and fail fast with an actionable message.
 */
const LEGACY_TYPES = new Set<LegacyEventType>([
  'child/created',
  'agent/session-bound',
  'agent/session-completed',
  'child/session-started',
  'child/session-completed',
])

function isLegacyType(type: string): type is LegacyEventType {
  return LEGACY_TYPES.has(type as LegacyEventType)
}

/** Append-only domain history physically contained by each flat Surface directory. */
export class WorkSessionLog {
  constructor(private readonly surfacesRoot: string) {}

  /** Create or verify the one Work Session owned by a Surface. */
  async initialize(
    surfaceInput: string,
    parentSurfaceInput: string | null,
    initial: { readonly revision: Revision; readonly commitId: string },
    identity: { readonly attemptId: string; readonly idempotencyKey: string },
  ): Promise<WorkSessionSnapshot> {
    const surface = SurfaceId(surfaceInput)
    const parentSurfaceId = parentSurfaceInput === null ? null : SurfaceId(parentSurfaceInput)
    const paths = this.paths(surface)
    await mkdir(paths.events, { recursive: true, mode: 0o700 })
    await withRecoverableLock(paths.lock, async () => {
      const existing = await readJsonOptional<WorkSessionHeader>(paths.header)
      if (existing !== undefined) {
        validateHeader(existing, surface)
        if (existing.parentSurfaceId !== parentSurfaceId) {
          throw new WorkSurfaceError('canonical-corrupt', `Work Session parent disagrees for Surface '${surface}'`)
        }
        return
      }
      const header: WorkSessionHeader = {
        version: 1,
        surfaceId: surface,
        parentSurfaceId,
        createdAt: new Date().toISOString(),
      }
      await writeJsonAtomic(paths.header, header)
    })
    await this.append({
      surface,
      type: 'surface/created',
      data: { parentSurfaceId, revision: initial.revision, commitId: initial.commitId },
      attemptId: identity.attemptId,
      idempotencyKey: identity.idempotencyKey,
    })
    return this.read(surface)
  }

  /** Append one idempotent accepted fact and atomically advance the Session head projection. */
  async append<T extends WorkSessionEventType>(options: AppendWorkSessionEventOptions<T>): Promise<WorkSessionEvent<T>> {
    const surface = SurfaceId(options.surface)
    if (options.idempotencyKey.trim() === '' || options.idempotencyKey.includes('\0')) {
      throw new WorkSurfaceError('invalid-id', 'Work Session idempotency key must not be blank')
    }
    const paths = this.paths(surface)
    await mkdir(paths.events, { recursive: true, mode: 0o700 })
    return withRecoverableLock(paths.lock, async () => {
      const header = await readJsonOptional<WorkSessionHeader>(paths.header)
      if (header === undefined) throw new WorkSurfaceError('not-found', `Surface '${surface}' has no Work Session`)
      validateHeader(header, surface)
      const events = await this.readEvents(surface, paths.events)
      validateHistory(events, surface)
      const existing = events.find(event => event.idempotencyKey === options.idempotencyKey)
      const identity = {
        type: options.type,
        data: options.data,
        causationId: options.causationId,
        correlationId: options.correlationId,
        attemptId: options.attemptId,
      }
      if (existing !== undefined) {
        if (stableStringify({
          type: existing.type,
          data: existing.data,
          causationId: existing.causationId,
          correlationId: existing.correlationId,
          attemptId: existing.attemptId,
        }) !== stableStringify(identity)) {
          throw new WorkSurfaceError('idempotency-key-conflict', `Work Session key '${options.idempotencyKey}' was reused with another fact`, {
            surface,
            idempotencyKey: options.idempotencyKey,
          })
        }
        return existing as WorkSessionEvent<T>
      }
      validateTransition(events, surface, options.type, options.data, 'invalid-working-copy')
      const seq = events.length
      const eventId = sha256(stableStringify({ surface, seq, idempotencyKey: options.idempotencyKey, ...identity }))
      const event = {
        version: 1,
        surface,
        seq,
        eventId,
        type: options.type,
        data: options.data,
        createdAt: new Date().toISOString(),
        ...(options.causationId === undefined ? {} : { causationId: options.causationId }),
        ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
        ...(options.attemptId === undefined ? {} : { attemptId: options.attemptId }),
        idempotencyKey: options.idempotencyKey,
      } as WorkSessionEvent<T>
      await writeJsonAtomic(join(paths.events, eventFile(seq)), event)
      await writeJsonAtomic(paths.head, { seq, eventId } satisfies WorkSessionHead)
      return event
    })
  }

  /** Replay one complete Surface-local Work Session. */
  async read(surfaceInput: string): Promise<WorkSessionSnapshot> {
    const surface = SurfaceId(surfaceInput)
    const paths = this.paths(surface)
    await this.readHeader(surface)
    return withRecoverableLock(paths.lock, async () => {
      const header = await readJsonOptional<WorkSessionHeader>(paths.header)
      if (header === undefined) throw new WorkSurfaceError('not-found', `Surface '${surface}' has no Work Session`)
      validateHeader(header, surface)
      const events = await this.readEvents(surface, paths.events)
      if (events.length === 0) {
        throw new WorkSurfaceError('not-found', `Surface '${surface}' has no published Work Session`)
      }
      if (events[0]?.type !== 'surface/created') {
        throw new WorkSurfaceError('canonical-corrupt', `Work Session '${surface}' has no initial surface/created fact`)
      }
      validateHistory(events, surface)
      const creation = events[0].data as WorkSessionEventDataMap['surface/created']
      if (creation.parentSurfaceId !== header.parentSurfaceId) {
        throw new WorkSurfaceError('canonical-corrupt', `Work Session '${surface}' creation fact disagrees with its header`)
      }
      const head = await readJsonOptional<WorkSessionHead>(paths.head)
      const last = events.at(-1)
      if (last === undefined) throw new WorkSurfaceError('canonical-corrupt', `Work Session '${surface}' has no events`)
      if (head !== undefined && (head.seq > last.seq || (head.seq === last.seq && head.eventId !== last.eventId))) {
        throw new WorkSurfaceError('canonical-corrupt', `Work Session '${surface}' HEAD references a missing or different event`)
      }
      if (head === undefined || head.seq < last.seq) {
        await writeJsonAtomic(paths.head, { seq: last.seq, eventId: last.eventId } satisfies WorkSessionHead)
      }
      return { header, events }
    })
  }

  /** Read and verify the immutable identity of one Surface-local Work Session. */
  async readHeader(surfaceInput: string): Promise<WorkSessionHeader> {
    const surface = SurfaceId(surfaceInput)
    const header = await readJsonOptional<WorkSessionHeader>(this.paths(surface).header)
    if (header === undefined) throw new WorkSurfaceError('not-found', `Surface '${surface}' has no Work Session`)
    validateHeader(header, surface)
    return header
  }

  private async readEvents(surface: SurfaceIdType, directory: string): Promise<WorkSessionEvent[]> {
    let names: string[]
    try {
      names = (await readdir(directory)).filter(name => EVENT_FILE.test(name)).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const events: WorkSessionEvent[] = []
    for (const [seq, name] of names.entries()) {
      const match = EVENT_FILE.exec(name)
      if (match === null || Number(match[1]) !== seq) {
        throw new WorkSurfaceError('canonical-corrupt', `Work Session '${surface}' event files are not contiguous`)
      }
      const event = JSON.parse(await readFile(join(directory, name), 'utf8')) as WorkSessionEvent
      validateEvent(event, surface, seq)
      events.push(event)
    }
    return events
  }

  private paths(surface: SurfaceIdType) {
    const root = join(this.surfacesRoot, surface, 'session')
    return {
      root,
      header: join(root, 'header.json'),
      head: join(root, 'HEAD.json'),
      events: join(root, 'events'),
      lock: join(root, 'append.lock'),
    }
  }
}

function validateHeader(header: WorkSessionHeader, surface: SurfaceIdType): void {
  if (header.version !== 1 || header.surfaceId !== surface || typeof header.createdAt !== 'string') {
    throw new WorkSurfaceError('canonical-corrupt', `invalid Work Session header for Surface '${surface}'`)
  }
  if (header.parentSurfaceId !== null) SurfaceId(header.parentSurfaceId)
}

function validateEvent(event: WorkSessionEvent, surface: SurfaceIdType, seq: number): void {
  if (event.version !== 1 || event.surface !== surface || event.seq !== seq
    || typeof event.eventId !== 'string' || event.eventId === ''
    || typeof event.createdAt !== 'string'
    || event.data === null || typeof event.data !== 'object'
    || typeof event.idempotencyKey !== 'string' || event.idempotencyKey === '') {
    throw new WorkSurfaceError('canonical-corrupt', `invalid Work Session event ${seq} for Surface '${surface}'`)
  }
  if (isLegacyType(event.type)) {
    throw new WorkSurfaceError('canonical-corrupt',
      `Work Session event ${seq} for Surface '${surface}' is a legacy '${event.type}' fact; `
      + 'a Surface exists only when its Session exists, child existence is owned by delegation records aligned with the DSH Session tree, '
      + 'and Agent/Session attachment is a write-once delegation record. '
      + 'Recreate the Surface or migrate its rc.6 state.',
      { surface, seq, type: event.type })
  }
  if (!EVENT_TYPES.has(event.type)) {
    throw new WorkSurfaceError('canonical-corrupt', `Work Session event ${seq} for Surface '${surface}' has an unknown type '${event.type}'`)
  }
  const expectedId = sha256(stableStringify({
    surface,
    seq,
    idempotencyKey: event.idempotencyKey,
    type: event.type,
    data: event.data,
    causationId: event.causationId,
    correlationId: event.correlationId,
    attemptId: event.attemptId,
  }))
  if (event.eventId !== expectedId) {
    throw new WorkSurfaceError('canonical-corrupt', `Work Session event ${seq} for Surface '${surface}' failed identity verification`)
  }
}

function validateHistory(events: readonly WorkSessionEvent[], surface: SurfaceIdType): void {
  const accepted: WorkSessionEvent[] = []
  for (const event of events) {
    validateTransition(accepted, surface, event.type, event.data)
    accepted.push(event)
  }
}

function validateTransition(
  events: readonly WorkSessionEvent[],
  surface: SurfaceIdType,
  type: WorkSessionEventType,
  data: WorkSessionEventDataMap[WorkSessionEventType],
  code: 'canonical-corrupt' | 'invalid-working-copy' = 'canonical-corrupt',
): void {
  const corrupt = (message: string): never => {
    throw new WorkSurfaceError(code, `Work Session '${surface}' ${message}`)
  }
  if (events.length === 0) {
    if (type !== 'surface/created') corrupt('must start with surface/created')
    const creation = data as WorkSessionEventDataMap['surface/created']
    if (creation.parentSurfaceId !== null) SurfaceId(creation.parentSurfaceId)
    assertEventRevision(creation.revision, corrupt)
    if (typeof creation.commitId !== 'string' || creation.commitId === '') corrupt('has an invalid initial commit id')
    return
  }
  if (type === 'surface/created') corrupt('contains more than one surface/created fact')
  if (type === 'surface/revision-published') {
    const publication = data as WorkSessionEventDataMap['surface/revision-published']
    assertEventRevision(publication.revision, corrupt)
    assertEventRevision(publication.previousRevision, corrupt)
    if (typeof publication.commitId !== 'string' || publication.commitId === '') corrupt('has an invalid revision commit id')
    const previous = [...events].reverse().find(event => event.type === 'surface/revision-published' || event.type === 'surface/created')
    const current = previous?.type === 'surface/created'
      ? (previous.data as WorkSessionEventDataMap['surface/created']).revision
      : (previous?.data as WorkSessionEventDataMap['surface/revision-published'] | undefined)?.revision
    if (current !== publication.previousRevision) corrupt('publishes a revision from a non-current base')
  }
  if (type === 'orchestrator/run-started') {
    const run = data as WorkSessionEventDataMap['orchestrator/run-started']
    const defined = events.some(event => event.type === 'orchestrator/defined'
      && (event.data as WorkSessionEventDataMap['orchestrator/defined']).definitionRevision === run.definitionRevision)
    if (!defined || events.some(event => event.type === 'orchestrator/run-started'
      && (event.data as WorkSessionEventDataMap['orchestrator/run-started']).runId === run.runId)) {
      corrupt(`starts invalid Orchestrator run '${run.runId}'`)
    }
  }
  if (type === 'orchestrator/run-completed' || type === 'orchestrator/run-interrupted' || type === 'orchestrator/run-failed') {
    const terminal = data as WorkSessionEventDataMap['orchestrator/run-completed']
      | WorkSessionEventDataMap['orchestrator/run-interrupted']
      | WorkSessionEventDataMap['orchestrator/run-failed']
    const started = events.some(event => event.type === 'orchestrator/run-started'
      && (event.data as WorkSessionEventDataMap['orchestrator/run-started']).runId === terminal.runId)
    const alreadyTerminal = events.some(event => (event.type === 'orchestrator/run-completed'
      || event.type === 'orchestrator/run-interrupted' || event.type === 'orchestrator/run-failed')
      && (event.data as { runId?: string }).runId === terminal.runId)
    if (!started || alreadyTerminal) corrupt(`contains an invalid terminal fact for Orchestrator run '${terminal.runId}'`)
  }
}

function assertEventRevision(value: unknown, corrupt: (message: string) => never): asserts value is Revision {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) corrupt('contains an invalid revision')
}

function eventFile(seq: number): string {
  return `${String(seq).padStart(12, '0')}.json`
}

async function readJsonOptional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) throw new WorkSurfaceError('canonical-corrupt', `invalid JSON at ${path}`)
    throw error
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
