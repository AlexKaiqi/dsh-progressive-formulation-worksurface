import { mkdir, open, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { WorkSurfaceError } from './error.ts'
import { stableStringify } from './hash.ts'
import {
  validateOperationBatch,
  validateOperationSettlement,
  validateRegistrationRecord,
  validateRuntimeEventRef,
  type AuthorityId,
  type OrchestrateInputLedgerRecord,
  type OrchestrateOperationBatch,
  type OrchestrateOperationSettlement,
  type OrchestrateRegistrationRecord,
  type RuntimeEventRef,
} from './runtime-protocol.ts'
import {
  acquireRuntimeLock,
  durableCreate,
  readRuntimeJson,
  runtimeCorrupt,
  runtimeInvalid,
  syncDirectory,
  validateRuntimeLocalId,
} from './runtime-store-io.ts'

/** Immutable admitted Registration facts. */
export class RegistrationRecordStore {
  readonly root: string
  constructor(root: string, readonly authority: AuthorityId) { this.root = resolve(root) }
  async init(): Promise<void> { await mkdir(this.root, { recursive: true, mode: 0o700 }) }
  async put(record: OrchestrateRegistrationRecord): Promise<void> {
    validateRegistrationRecord(record)
    if (record.authority !== this.authority) throw runtimeInvalid('Registration authority does not match its store')
    await this.init()
    const path = this.path(record.registrationId)
    try { await durableCreate(path, record) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(record.registrationId)
      if (stableStringify(existing) !== stableStringify(record)) throw new WorkSurfaceError('already-exists-conflict', `Registration '${record.registrationId}' already fixes different facts`)
    }
  }
  async get(id: string): Promise<OrchestrateRegistrationRecord> {
    validateRuntimeLocalId(id, 'Registration id')
    const value = await readRuntimeJson(this.path(id), `Registration '${id}'`)
    validateRegistrationRecord(value)
    if (value.authority !== this.authority || value.registrationId !== id) throw runtimeCorrupt(`Registration '${id}' has the wrong identity`)
    return value
  }
  async list(): Promise<readonly string[]> {
    await this.init()
    return (await readdir(this.root, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => decodeURIComponent(entry.name.slice(0, -5))).sort()
  }
  private path(id: string): string { return join(this.root, `${encodeURIComponent(id)}.json`) }
}

/** Per-Registration accepted input EventRefs. */
export class InputLedgerStore {
  readonly root: string
  private readonly mutations = new Map<string, Promise<void>>()
  constructor(root: string, readonly authority: AuthorityId) { this.root = resolve(root) }
  async init(): Promise<void> { await Promise.all([mkdir(this.root, { recursive: true, mode: 0o700 }), mkdir(join(this.root, '..', 'locks'), { recursive: true, mode: 0o700 })]) }

  append(registrationId: string, event: RuntimeEventRef): Promise<OrchestrateInputLedgerRecord> {
    validateRuntimeLocalId(registrationId, 'Registration id'); validateRuntimeEventRef(event)
    return this.serialize(registrationId, async () => {
      await this.init()
      const release = await acquireRuntimeLock(join(this.root, '..', 'locks', `input-${encodeURIComponent(registrationId)}.lock`))
      try {
        const records = await this.replay(registrationId)
        const existing = records.find(record => stableStringify(record.event) === stableStringify(event))
        if (existing !== undefined) return existing
        const record: OrchestrateInputLedgerRecord = { version: 1, authority: this.authority, registrationId, inputSeq: records.length, event: structuredClone(event), acceptedAt: new Date().toISOString() }
        validateInputRecord(record, this.authority, registrationId, records.length)
        const handle = await open(this.path(registrationId), 'a', 0o600)
        try { await handle.write(`${stableStringify(record)}\n`); await handle.sync() } finally { await handle.close() }
        await syncDirectory(this.root)
        return record
      } finally { await release() }
    })
  }

  async replay(registrationId: string): Promise<readonly OrchestrateInputLedgerRecord[]> {
    validateRuntimeLocalId(registrationId, 'Registration id')
    let content: string
    try { content = await readFile(this.path(registrationId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const lines = content.split('\n')
    if (lines.at(-1) !== '') throw runtimeCorrupt(`Input Ledger '${registrationId}' has a torn final record`)
    return lines.slice(0, -1).map((line, index) => {
      let value: unknown
      try { value = JSON.parse(line) } catch { throw runtimeCorrupt(`Input Ledger '${registrationId}' record ${index} is invalid JSON`) }
      validateInputRecord(value, this.authority, registrationId, index)
      return value
    })
  }
  private path(id: string): string { return join(this.root, `${encodeURIComponent(id)}.jsonl`) }
  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutations.set(key, settled)
    void settled.finally(() => { if (this.mutations.get(key) === settled) this.mutations.delete(key) })
    return result
  }
}

/** Authority-global record/apply/settle recovery facts. */
export class OperationLedgerStore {
  readonly root: string
  constructor(root: string, readonly authority: AuthorityId) { this.root = resolve(root) }
  async init(): Promise<void> { await Promise.all([mkdir(join(this.root, 'recorded'), { recursive: true, mode: 0o700 }), mkdir(join(this.root, 'settled'), { recursive: true, mode: 0o700 })]) }
  async record(batch: OrchestrateOperationBatch): Promise<void> {
    validateOperationBatch(batch); this.assertIdentity(batch.authority, batch.runId); await this.init()
    try { await durableCreate(this.recordedPath(batch.runId), batch) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.getRecorded(batch.runId)
      if (stableStringify(existing) !== stableStringify(batch)) throw new WorkSurfaceError('already-exists-conflict', `run '${batch.runId}' already records a different Operation batch`)
    }
  }
  async settle(settlement: OrchestrateOperationSettlement): Promise<void> {
    validateOperationSettlement(settlement); this.assertIdentity(settlement.authority, settlement.runId); await this.getRecorded(settlement.runId); await this.init()
    try { await durableCreate(this.settledPath(settlement.runId), settlement) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.getSettlement(settlement.runId)
      if (stableStringify(existing) !== stableStringify(settlement)) throw runtimeCorrupt(`run '${settlement.runId}' has conflicting settlements`)
    }
  }
  async getRecorded(runId: string): Promise<OrchestrateOperationBatch> { const value = await readRuntimeJson(this.recordedPath(runId), `Operation batch '${runId}'`); validateOperationBatch(value); this.assertIdentity(value.authority, value.runId); return value }
  async getSettlement(runId: string): Promise<OrchestrateOperationSettlement> { const value = await readRuntimeJson(this.settledPath(runId), `Operation settlement '${runId}'`); validateOperationSettlement(value); this.assertIdentity(value.authority, value.runId); return value }
  async pending(): Promise<readonly OrchestrateOperationBatch[]> {
    await this.init()
    const settled = new Set((await readdir(join(this.root, 'settled'))).filter(name => name.endsWith('.json')).map(name => decodeURIComponent(name.slice(0, -5))))
    const ids = (await readdir(join(this.root, 'recorded'))).filter(name => name.endsWith('.json')).map(name => decodeURIComponent(name.slice(0, -5))).filter(id => !settled.has(id)).sort()
    return Promise.all(ids.map(id => this.getRecorded(id)))
  }
  async recorded(): Promise<readonly OrchestrateOperationBatch[]> {
    await this.init()
    const ids = (await readdir(join(this.root, 'recorded'))).filter(name => name.endsWith('.json')).map(name => decodeURIComponent(name.slice(0, -5))).sort()
    return Promise.all(ids.map(id => this.getRecorded(id)))
  }
  private assertIdentity(authority: AuthorityId, runId: string): void { if (authority !== this.authority) throw runtimeInvalid('Operation authority does not match its store'); validateRuntimeLocalId(runId, 'Run id') }
  private recordedPath(id: string): string { validateRuntimeLocalId(id, 'Run id'); return join(this.root, 'recorded', `${encodeURIComponent(id)}.json`) }
  private settledPath(id: string): string { validateRuntimeLocalId(id, 'Run id'); return join(this.root, 'settled', `${encodeURIComponent(id)}.json`) }
}

function validateInputRecord(value: unknown, authority: AuthorityId, registrationId: string, inputSeq: number): asserts value is OrchestrateInputLedgerRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw runtimeCorrupt('Input Ledger record must be an object')
  const record = value as Record<string, unknown>
  if (stableStringify(Object.keys(record).sort()) !== stableStringify(['acceptedAt', 'authority', 'event', 'inputSeq', 'registrationId', 'version'])) throw runtimeCorrupt('Input Ledger record has an invalid shape')
  if (record.version !== 1 || record.authority !== authority || record.registrationId !== registrationId || record.inputSeq !== inputSeq || typeof record.acceptedAt !== 'string' || !Number.isFinite(Date.parse(record.acceptedAt))) throw runtimeCorrupt('Input Ledger record has the wrong identity')
  validateRuntimeEventRef(record.event)
}
