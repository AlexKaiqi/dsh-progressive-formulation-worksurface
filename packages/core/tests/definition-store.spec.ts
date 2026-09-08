import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefinitionStore, type OrchestrationDefinition } from '../src/index.ts'

const writes = vi.hoisted(() => ({ beforeWrite: undefined as (() => Promise<void>) | undefined }))

// Pause after a real exclusive create, before any bytes are written. This exposes
// the filesystem window deterministically for both writeFile and open consumers.
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] === 'wx' && writes.beforeWrite !== undefined) {
        const pause = writes.beforeWrite; writes.beforeWrite = undefined
        await pause()
      }
      return handle
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      const options = args[2]
      if (options === null || typeof options !== 'object' || options.flag !== 'wx' || writes.beforeWrite === undefined) return fs.writeFile(...args)
      const handle = await fs.open(args[0] as string, 'wx', options.mode)
      const pause = writes.beforeWrite; writes.beforeWrite = undefined
      try { await pause(); await handle.writeFile(args[1], options) } finally { await handle.close() }
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  writes.beforeWrite = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const revision = `sha256:${'a'.repeat(64)}`
const definition: OrchestrationDefinition = {
  version: 1,
  roles: ['worker'],
  subscriptions: [{
    id: 'ready', history: 'all', when: { role: 'worker', event: 'work.ready' },
    reaction: { emit: [{ role: 'worker', event: 'work.accepted', operationKey: 'accept', payload: {} }] },
  }],
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-definition-store-')); roots.push(root)
  let release!: () => void
  let created!: () => void
  const paused = new Promise<void>(resolve => { created = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  writes.beforeWrite = async () => { created(); await resume }
  return { root, first: new DefinitionStore(root), second: new DefinitionStore(root), paused, release }
}

describe('DefinitionStore atomic publication', () => {
  it('allows an identical retry while another writer has created but not written its file', async () => {
    const f = await fixture()
    const first = f.first.putRevision(revision, definition)
    try {
      await f.paused
      await expect(f.second.putRevision(revision, definition)).resolves.toMatchObject({ revision, definition })
      await expect(f.second.get(revision)).resolves.toMatchObject({ revision, definition })
    } finally {
      f.release()
      await first
    }
    expect(await readdir(f.root)).toEqual([`${revision.slice('sha256:'.length)}.json`])
  })

  it('retains the completed winner when a paused writer later publishes conflicting bytes', async () => {
    const f = await fixture()
    const first = f.first.putRevision(revision, definition)
    const settled = Promise.allSettled([first])
    const changed: OrchestrationDefinition = { ...definition, subscriptions: [{ ...definition.subscriptions[0]!, id: 'changed' }] }
    try {
      await f.paused
      await expect(f.second.putRevision(revision, changed)).resolves.toMatchObject({ definition: changed })
    } finally {
      f.release()
      await settled
    }
    await expect(first).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await expect(f.second.get(revision)).resolves.toMatchObject({ definition: changed })
    expect(await readdir(f.root)).toEqual([`${revision.slice('sha256:'.length)}.json`])
  })
})
