import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DefinitionStore, RevisionStore, SURFACE_TEMPLATE } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture(): Promise<{ root: string; surface: string; store: RevisionStore }> {
  const root = await mkdtemp(join(tmpdir(), 'ws-revisions-')); roots.push(root)
  const surface = join(root, 'surface'); await mkdir(surface)
  await writeFile(join(surface, 'surface.md'), SURFACE_TEMPLATE)
  return { root, surface, store: new RevisionStore(join(root, 'state', 'revisions')) }
}

describe('RevisionStore v1', () => {
  it('records canonical file metadata and materializes the exact bytes and executable bit', async () => {
    const { root, surface, store } = await fixture()
    await mkdir(join(surface, 'bin'))
    await writeFile(join(surface, 'bin', 'run.sh'), '#!/bin/sh\necho ok\n')
    await chmod(join(surface, 'bin', 'run.sh'), 0o755)
    const stored = await store.snapshotSurface(surface)
    expect(stored.manifest).toMatchObject({ version: 1, kind: 'surface' })
    expect(stored.manifest.entries.find(entry => entry.path === 'bin/run.sh')).toMatchObject({ type: 'file', executable: true, size: 18 })
    const target = join(root, 'checkout')
    await store.materialize(stored.revision, target)
    expect(await readFile(join(target, 'surface.md'), 'utf8')).toBe(SURFACE_TEMPLATE)
    expect((await store.snapshotSurface(target)).revision).toBe(stored.revision)
  })

  it('keeps the code template byte-for-byte equal to the normative spec file', async () => {
    expect(await readFile(new URL('../../../spec/surface-template.md', import.meta.url), 'utf8')).toBe(SURFACE_TEMPLATE)
  })

  it('rejects missing/reordered sections and runtime-owned frontmatter', async () => {
    const { surface, store } = await fixture()
    await writeFile(join(surface, 'surface.md'), '# Goal\n\n# Acceptance Criteria\n')
    await expect(store.snapshotSurface(surface)).rejects.toMatchObject({ code: 'invalid-working-copy' })
    await writeFile(join(surface, 'surface.md'), `---\nstatus: running\n---\n${SURFACE_TEMPLATE}`)
    await expect(store.snapshotSurface(surface)).rejects.toThrow(/runtime-owned/)
  })

  it('rejects symlinks and enforces configured size limits', async () => {
    const { root, surface, store } = await fixture()
    await symlink(join(root, 'outside'), join(surface, 'escape'))
    await expect(store.snapshotSurface(surface)).rejects.toThrow(/unsupported entry/)
    await rm(join(surface, 'escape'))
    await writeFile(join(surface, 'large.bin'), Buffer.alloc(32))
    await expect(store.snapshotSurface(surface, { maxFileBytes: 16 })).rejects.toThrow(/exceeds/)
  })

  it('snapshots the complete Definition directory and requires referenced handlers', async () => {
    const { root, store } = await fixture()
    const definition = join(root, 'orchestration'); await mkdir(definition)
    await writeFile(join(definition, 'definition.json'), JSON.stringify({
      version: 1,
      roles: ['source', 'target'],
      subscriptions: [{ id: 'handler', history: 'all', when: { role: 'source', event: 'ready' },
        reaction: { handler: { command: 'node', path: 'handlers/run.mjs', reads: ['source'], emits: ['target'] } } }],
    }))
    await expect(store.snapshotDefinition(definition)).rejects.toThrow(/absent/)
    await mkdir(join(definition, 'handlers'))
    await writeFile(join(definition, 'handlers', 'run.mjs'), 'process.exit(0)\n')
    await writeFile(join(definition, 'registration.json'), JSON.stringify({ version: 1, registrationId: 'reg-a', bindings: { source: 'a', target: 'b' } }))
    const snapshot = await store.snapshotDefinition(definition)
    expect(snapshot.manifest.entries.map(entry => entry.path)).toContain('handlers/run.mjs')
    expect(snapshot.manifest.entries.map(entry => entry.path)).not.toContain('registration.json')
    await expect(new DefinitionStore(join(root, 'definition-cache'), store).get(snapshot.revision)).resolves.toMatchObject({ revision: snapshot.revision })
    await rm(join(definition, 'registration.json'))
    await writeFile(join(root, 'outside-registration.json'), '{}')
    await symlink(join(root, 'outside-registration.json'), join(definition, 'registration.json'))
    await expect(store.snapshotDefinition(definition)).rejects.toThrow(/unsupported entry/)
  })

  it('mark-and-sweep collects an orphan snapshot while preserving reachable and pinned revisions', async () => {
    const { surface, store } = await fixture()
    const reachable = (await store.snapshotSurface(surface)).revision
    await writeFile(join(surface, 'orphan.txt'), 'orphan')
    const orphan = (await store.snapshotSurface(surface)).revision
    await writeFile(join(surface, 'pinned.txt'), 'pinned')
    const pinned = (await store.snapshotSurface(surface)).revision
    await store.pin(pinned)

    const result = await store.collect({ reachable: [reachable], minAgeMs: 0, now: Date.now() + 1_000 })
    expect(result.sweptRevisions).toContain(orphan)
    expect(result.sweptRevisions).not.toContain(reachable)
    expect(result.sweptRevisions).not.toContain(pinned)
    await expect(store.read(orphan)).rejects.toMatchObject({ code: 'not-found' })
    await expect(store.read(reachable)).resolves.toMatchObject({ kind: 'surface' })
    await expect(store.read(pinned)).resolves.toMatchObject({ kind: 'surface' })

    await store.unpin(pinned)
    const second = await store.collect({ reachable: [reachable], minAgeMs: 0, now: Date.now() + 1_000 })
    expect(second.sweptRevisions).toContain(pinned)
  })

  it('retains recent unmarked objects so collection cannot race an in-flight snapshot', async () => {
    const { surface, store } = await fixture()
    const recent = (await store.snapshotSurface(surface)).revision
    const result = await store.collect({ reachable: [], minAgeMs: 60_000 })
    expect(result.retainedRecentRevisions).toBe(1)
    await expect(store.read(recent)).resolves.toMatchObject({ kind: 'surface' })
  })
})
// Invariant assertions: [WS-02] [WS-03]
