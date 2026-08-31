import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { WorkSurfaceError } from './error.ts'
import { stableStringify } from './hash.ts'
import {
  createAuthority,
  eventContractDigest,
  validateAuthority,
  validateRuntimeEventContract,
  type ContractDigest,
  type RuntimeAuthority,
  type RuntimeEventContract,
} from './runtime-protocol.ts'
import { durableCreate, runtimeCorrupt, validateRuntimeDigest } from './runtime-store-io.ts'

/** Persists the namespace before any qualified identity can be accepted. */
export class RuntimeAuthorityStore {
  readonly root: string
  constructor(root: string) { this.root = resolve(root) }

  async init(): Promise<RuntimeAuthority> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = join(this.root, 'authority.json')
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown
      validateAuthority(value)
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof SyntaxError) throw runtimeCorrupt('Runtime authority is invalid JSON')
        throw error
      }
    }
    const authority = createAuthority(`wsa_${randomBytes(16).toString('hex')}`)
    try { await durableCreate(path, authority) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const raced = JSON.parse(await readFile(path, 'utf8')) as unknown
      validateAuthority(raced)
      return raced
    }
    return authority
  }
}

/** Immutable, content-addressed Event Contract snapshots. */
export class EventContractStore {
  readonly root: string
  constructor(root: string) { this.root = resolve(root) }
  async init(): Promise<void> { await mkdir(join(this.root, 'sha256'), { recursive: true, mode: 0o700 }) }

  async put(contract: RuntimeEventContract): Promise<ContractDigest> {
    validateRuntimeEventContract(contract)
    const digest = eventContractDigest(contract)
    await this.init()
    const path = this.path(digest)
    try { await durableCreate(path, contract) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(digest)
      if (stableStringify(existing) !== stableStringify(contract)) throw runtimeCorrupt(`Contract '${digest}' names different content`)
    }
    return digest
  }

  async get(digest: ContractDigest): Promise<RuntimeEventContract> {
    validateRuntimeDigest(digest)
    let value: unknown
    try { value = JSON.parse(await readFile(this.path(digest), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkSurfaceError('not-found', `Event Contract '${digest}' does not exist`)
      if (error instanceof SyntaxError) throw runtimeCorrupt(`Event Contract '${digest}' is invalid JSON`)
      throw error
    }
    validateRuntimeEventContract(value)
    if (eventContractDigest(value) !== digest) throw runtimeCorrupt(`Event Contract '${digest}' failed content-address verification`)
    return value
  }

  private path(digest: ContractDigest): string { return join(this.root, 'sha256', `${digest.slice('sha256:'.length)}.json`) }
}
