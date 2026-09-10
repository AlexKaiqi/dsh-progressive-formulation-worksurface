// Normalize the DSH Session persistence service to the plugin's list+inspect
// port. dsh-session-persistence >= 0.1.5-alpha.1 exposes `list()` returning
// header-bearing snapshots plus `open(id, 'read')` → handle.read() for cold
// inspection; the pre-0.1.5 generation exposed `list()` → `{ id }` rows plus
// `inspect(id)`. The plugin compiles and runs against 0.1.5-alpha.1 and still
// tolerates the older shape so existing test fakes keep working.
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { WorkSurfaceError } from '@pf-worksurface/core'

export interface SessionInspectionRecord {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
}

/** Absent `signal` must not be passed explicitly under exactOptionalPropertyTypes. */
function abortOptions(signal?: AbortSignal): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}

interface PersistenceLike {
  readonly list?: (options?: { readonly signal?: AbortSignal } | AbortSignal) => Promise<readonly { readonly header?: SessionHeader; readonly id?: unknown }[]>
  readonly open?: (id: SessionId, access: 'read' | 'write', options?: { readonly signal?: AbortSignal }) => Promise<{
    readonly header: SessionHeader
    readonly read: (offset?: number, length?: number, options?: { readonly signal?: AbortSignal }) => Promise<{ readonly events: readonly SessionEvent[] }>
    readonly close: () => Promise<void>
  }>
  readonly inspect?: (id: SessionId, signal?: AbortSignal) => Promise<SessionInspectionRecord>
}

/** Ids of every stored Session, in no promised order; `undefined` when the service cannot enumerate. */
export async function persistedSessionIds(persistence: unknown, signal?: AbortSignal): Promise<string[] | undefined> {
  const p = persistence as PersistenceLike
  if (typeof p.list !== 'function') return undefined
  const rows = typeof p.open === 'function'
    ? await p.list(abortOptions(signal))
    : await p.list(signal)
  return rows.map(row => String(row.header?.id ?? row.id))
}

/** Cold-read one stored Session's immutable header plus its complete event log. */
export async function inspectPersistedSession(persistence: unknown, id: SessionId, signal?: AbortSignal): Promise<SessionInspectionRecord> {
  const p = persistence as PersistenceLike
  if (typeof p.open === 'function') {
    const handle = await p.open(id, 'read', abortOptions(signal))
    try {
      const read = await handle.read(0, undefined, abortOptions(signal))
      return { meta: handle.header, events: read.events }
    } finally {
      await handle.close()
    }
  }
  if (typeof p.inspect === 'function') {
    const inspection = signal === undefined ? await p.inspect(id) : await p.inspect(id, signal)
    if (!Array.isArray(inspection.events)) {
      throw new WorkSurfaceError('canonical-corrupt', `persisted DSH Session '${String(id)}' returned no event log`)
    }
    return inspection
  }
  throw new WorkSurfaceError('effect-failed', 'DSH Session persistence service exposes neither open nor inspect')
}
