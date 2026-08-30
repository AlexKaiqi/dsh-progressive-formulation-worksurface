import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineOrchestration, type OrchestrationDefinition, type StoredDefinition } from './event-model.ts'
import { WorkSurfaceError } from './error.ts'
import { stableStringify } from './hash.ts'

/** Immutable content-addressed storage for exact orchestration programs. */
export class DefinitionStore {
  readonly root: string

  constructor(root: string, private readonly revisions?: { readFile(revision: StoredDefinition['revision'], path: string): Promise<Buffer> }) {
    this.root = resolve(root)
  }

  /** Validate and durably retain one exact Definition. */
  async put(input: unknown): Promise<StoredDefinition> {
    const stored = defineOrchestration(input)
    return this.putRevision(stored.revision, stored.definition)
  }

  /** Retain a Definition under the content revision of its complete author directory. */
  async putRevision(revision: string, input: unknown): Promise<StoredDefinition> {
    if (!/^sha256:[0-9a-f]{64}$/.test(revision)) throw new WorkSurfaceError('invalid-id', `invalid Definition revision '${revision}'`)
    const validated = defineOrchestration(input)
    const stored: StoredDefinition = { revision: revision as StoredDefinition['revision'], definition: validated.definition }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = this.path(stored.revision)
    const content = `${stableStringify(stored.definition)}\n`
    try {
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await readFile(path, 'utf8')
      if (existing !== content) throw new WorkSurfaceError('canonical-corrupt', `Definition object '${stored.revision}' has different bytes`)
    }
    return stored
  }

  /** Read and revalidate one immutable Definition revision. */
  async get(revision: string): Promise<StoredDefinition> {
    const path = this.path(revision)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (this.revisions === undefined) throw new WorkSurfaceError('not-found', `Definition '${revision}' does not exist`)
        try {
          parsed = JSON.parse((await this.revisions.readFile(revision as StoredDefinition['revision'], 'definition.json')).toString('utf8'))
          return this.putRevision(revision, parsed)
        } catch (fallbackError) {
          if (fallbackError instanceof WorkSurfaceError) throw fallbackError
          throw new WorkSurfaceError('canonical-corrupt', `Definition '${revision}' cannot be rebuilt from its revision`)
        }
      }
      throw error
    }
    const validated = defineOrchestration(parsed)
    return { revision: revision as StoredDefinition['revision'], definition: validated.definition }
  }

  private path(revision: string): string {
    if (!/^sha256:[0-9a-f]{64}$/.test(revision)) throw new WorkSurfaceError('invalid-id', `invalid Definition revision '${revision}'`)
    return join(this.root, `${revision.slice('sha256:'.length)}.json`)
  }
}

/** Type-only assertion that stored Definitions remain ordinary Definitions. */
export type StoredDefinitionValue = OrchestrationDefinition
