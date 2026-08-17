import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BlockId, sha256, SurfaceId, WorkSurfaceStore } from '../src/index.ts'
import type { NewSurfaceResult, Revision } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(options: { blocks?: Record<string, string>; surface?: string } = {}): Promise<{
  root: string
  template: string
  store: WorkSurfaceStore
}> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-store-defensive-'))
  roots.push(root)
  const template = join(root, 'template')
  await mkdir(join(template, 'blocks'), { recursive: true })
  await writeFile(join(template, 'surface.md'), options.surface ?? '# Goal\n')
  for (const [id, body] of Object.entries(options.blocks ?? {})) {
    await writeFile(join(template, 'blocks', `${id}.md`), block(id, 'template', body))
  }
  return { root, template, store: new WorkSurfaceStore({ root: join(root, 'store') }) }
}

function block(id: string, surface: string, body = 'body'): string {
  return `---\nblock_id: ${id}\nsurface_id: ${surface}\nkind: evidence\nstatus: active\nderived_from: []\n---\n${body}\n`
}

function revisionRoot(store: WorkSurfaceStore, surface: string, revision: Revision): string {
  return join(store.canonicalRoot, 'surfaces', surface, 'revisions', revision.slice('sha256:'.length))
}

function surfaceRoot(store: WorkSurfaceStore, surface: string): string {
  return join(store.canonicalRoot, 'surfaces', surface)
}

async function checkout(store: WorkSurfaceStore, root: string, surface: string): Promise<{ path: string; revision: Revision }> {
  const path = join(root, `checkout-${surface}-${Math.random().toString(16).slice(2)}`)
  const result = await store.checkout({ surface, targetPath: path })
  return { path, revision: result.revision }
}

async function setJournalStatus(store: WorkSurfaceStore, attemptId: string, key: string, status: string): Promise<void> {
  const path = join(store.runtimeRoot, 'effect-journal', attemptId, `${sha256(key)}.json`)
  const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, `${JSON.stringify({ ...record, status })}\n`)
}

describe('WorkSurfaceStore defensive paths', () => {
  it('covers derived ids, explicit parents, retry fields, duplicate creation, checkout targets, and no-op commits', async () => {
    const { root, template, store } = await fixture({ blocks: { result: 'result' } })
    const parent = await store.newSurface({ attemptId: 'attempt', key: 'parent', templatePath: template, retry: false })
    expect(parent.surface).toMatch(/^ws-parent-/)
    const child = await store.newSurface({
      attemptId: 'attempt', key: 'child', templatePath: template, surface: 'ws-child', parent: parent.surface, retry: true,
    })
    expect(child.surface).toBe('ws-child')
    await setJournalStatus(store, 'attempt', 'child', 'started')
    await expect(store.newSurface({
      attemptId: 'attempt', key: 'child', templatePath: template, surface: 'ws-child', parent: parent.surface, retry: true,
    })).resolves.toEqual(child)
    await expect(store.newSurface({ attemptId: 'other', key: 'duplicate', templatePath: template, surface: 'ws-child' }))
      .rejects.toMatchObject({ code: 'already-exists' })

    const occupied = join(root, 'occupied')
    await mkdir(occupied)
    await writeFile(join(occupied, 'file'), 'x')
    await expect(store.checkout({ surface: parent.surface, targetPath: occupied }))
      .rejects.toMatchObject({ code: 'target-not-empty' })
    const fileTarget = join(root, 'file-target')
    await writeFile(fileTarget, 'x')
    await expect(store.checkout({ surface: parent.surface, targetPath: fileTarget })).rejects.toBeDefined()

    const working = await checkout(store, root, parent.surface)
    const noOp = await store.commit({
      attemptId: 'attempt', key: 'noop', workingPath: working.path, baseRevision: working.revision, retry: false,
    })
    expect(noOp).toMatchObject({ noOp: true, previousRevision: working.revision, revision: working.revision })
    await setJournalStatus(store, 'attempt', 'noop', 'started')
    await expect(store.commit({
      attemptId: 'attempt', key: 'noop', workingPath: working.path, baseRevision: working.revision, retry: true,
    })).resolves.toEqual(noOp)
  })

  it('rejects parent mutation, envelope mismatch, missing parents, Block header mismatch, and dangling cross-Surface refs', async () => {
    const { root, template, store } = await fixture({ blocks: { result: 'result' } })
    const created = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })

    const parentWorking = await checkout(store, root, 'ws-root')
    const surfacePath = join(parentWorking.path, 'surface.md')
    await writeFile(surfacePath, (await readFile(surfacePath, 'utf8')).replace('parent: null', 'parent: ws-other'))
    await expect(store.commit({ attemptId: 'a', key: 'parent-change', workingPath: parentWorking.path, baseRevision: created.revision }))
      .rejects.toMatchObject({ code: 'unauthorized' })

    const envelopeWorking = await checkout(store, root, 'ws-root')
    await writeFile(join(envelopeWorking.path, 'surface.md'),
      (await readFile(join(envelopeWorking.path, 'surface.md'), 'utf8')).replace('surface_id: ws-root', 'surface_id: ws-other'))
    await expect(store.commit({ attemptId: 'a', key: 'surface-change', workingPath: envelopeWorking.path, baseRevision: created.revision }))
      .rejects.toMatchObject({ code: 'not-found' })

    await expect(store.newSurface({
      attemptId: 'a', key: 'missing-parent', templatePath: template, surface: 'ws-child', parent: 'ws-missing',
    })).rejects.toMatchObject({ code: 'not-found' })

    const blockWorking = await checkout(store, root, 'ws-root')
    await writeFile(join(blockWorking.path, 'blocks', 'result.md'), block('other', 'ws-root'))
    await expect(store.commit({ attemptId: 'a', key: 'block-header', workingPath: blockWorking.path, baseRevision: created.revision }))
      .rejects.toMatchObject({ code: 'block-header-mismatch' })

    const ownDangling = await fixture({ surface: '# Goal\n\n[[block:ws-own/missing]]\n' })
    await expect(ownDangling.store.newSurface({
      attemptId: 'a', key: 'own', templatePath: ownDangling.template, surface: 'ws-own',
    })).rejects.toMatchObject({ code: 'dangling-reference' })
    const crossDangling = await fixture({ surface: '# Goal\n\n[[block:ws-missing/result]]\n' })
    await expect(crossDangling.store.newSurface({
      attemptId: 'a', key: 'cross', templatePath: crossDangling.template, surface: 'ws-root',
    })).rejects.toMatchObject({ code: 'not-found' })

    const crossMissingBlock = await fixture()
    await crossMissingBlock.store.newSurface({
      attemptId: 'a', key: 'source', templatePath: crossMissingBlock.template, surface: 'ws-source',
    })
    await writeFile(join(crossMissingBlock.template, 'surface.md'), '# Goal\n\n[[block:ws-source/missing]]\n')
    await expect(crossMissingBlock.store.newSurface({
      attemptId: 'a', key: 'root', templatePath: crossMissingBlock.template, surface: 'ws-root',
    })).rejects.toMatchObject({ code: 'dangling-reference' })
  })

  it('rejects missing and corrupted snapshots, HEAD pointers, commit records, and histories', async () => {
    const { root, template, store } = await fixture({ blocks: { result: 'result' } })
    const created = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    const missingRevision: Revision = `sha256:${'0'.repeat(64)}`
    await expect(store.readSnapshot('ws-root', missingRevision)).rejects.toMatchObject({ code: 'not-found' })
    await expect(store.readSnapshot('ws-root', 'bad' as Revision)).rejects.toMatchObject({ code: 'invalid-id' })
    await expect(store.readHead('ws-missing')).rejects.toMatchObject({ code: 'not-found' })

    const headPath = join(surfaceRoot(store, 'ws-root'), 'HEAD.json')
    const originalHead = await readFile(headPath, 'utf8')
    await writeFile(headPath, '{')
    await expect(store.readHead('ws-root')).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(headPath, JSON.stringify({ revision: 'bad', commitId: 'commit' }))
    await expect(store.readHead('ws-root')).rejects.toMatchObject({ code: 'invalid-id' })
    await writeFile(headPath, JSON.stringify({ revision: created.revision, commitId: '' }))
    await expect(store.readHead('ws-root')).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(headPath, originalHead)

    await rm(headPath)
    await mkdir(headPath)
    await expect(store.readHead('ws-root')).rejects.toMatchObject({ code: 'EISDIR' })
    await rm(headPath, { recursive: true })
    await writeFile(headPath, originalHead)

    const canonicalSurface = join(revisionRoot(store, 'ws-root', created.revision), 'surface.md')
    const originalSurface = await readFile(canonicalSurface, 'utf8')
    await writeFile(canonicalSurface, `${originalSurface}\ntamper\n`)
    await expect(store.readSnapshot('ws-root', created.revision)).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(canonicalSurface, originalSurface)

    const malformedRevision: Revision = `sha256:${'1'.repeat(64)}`
    await mkdir(revisionRoot(store, 'ws-root', malformedRevision), { recursive: true })
    await writeFile(join(revisionRoot(store, 'ws-root', malformedRevision), 'unexpected'), 'x')
    await expect(store.readSnapshot('ws-root', malformedRevision)).rejects.toMatchObject({ code: 'invalid-working-copy' })

    const head = JSON.parse(originalHead) as { commitId: string; revision: Revision }
    const commitPath = join(surfaceRoot(store, 'ws-root'), 'commits', `${head.commitId}.json`)
    const originalCommit = JSON.parse(await readFile(commitPath, 'utf8')) as Record<string, unknown>
    await writeFile(commitPath, JSON.stringify({ ...originalCommit, surface: 'ws-other' }))
    await expect(store.history('ws-root')).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(commitPath, JSON.stringify({ ...originalCommit, parentCommitId: head.commitId }))
    await expect(store.history('ws-root')).rejects.toMatchObject({ code: 'canonical-corrupt' })
    await rm(commitPath)
    await expect(store.history('ws-root')).rejects.toMatchObject({ code: 'canonical-corrupt' })
    expect(root).toBeTruthy()
  })

  it('rejects malformed working-tree entry kinds and NUL text', async () => {
    const cases: Array<(path: string) => Promise<void>> = [
      async (path) => { await writeFile(join(path, 'surface.md'), '# Goal\n'); await symlink(join(path, 'surface.md'), join(path, 'blocks')) },
      async (path) => { await mkdir(join(path, 'surface.md')) },
      async (path) => { await writeFile(join(path, 'surface.md'), '# Goal\n'); await writeFile(join(path, 'blocks'), 'not a directory') },
      async (path) => { await writeFile(join(path, 'surface.md'), '# Goal\n'); await mkdir(join(path, 'blocks')); await mkdir(join(path, 'blocks', 'nested')) },
      async (path) => { await writeFile(join(path, 'surface.md'), '# Goal\n'); await mkdir(join(path, 'blocks')); await writeFile(join(path, 'blocks', 'bad.txt'), 'x') },
      async (path) => { await writeFile(join(path, 'surface.md'), Buffer.from('bad\0text')) },
    ]
    for (const [index, prepare] of cases.entries()) {
      const { root, store } = await fixture()
      const path = join(root, `malformed-${index}`)
      await mkdir(path)
      await prepare(path)
      await expect(store.newSurface({ attemptId: 'a', key: `bad-${index}`, templatePath: path, surface: `ws-bad-${index}` }))
        .rejects.toMatchObject({ code: 'invalid-working-copy' })
    }

    const { root, store } = await fixture()
    const noBlocks = join(root, 'no-blocks')
    await mkdir(noBlocks)
    await writeFile(join(noBlocks, 'surface.md'), '# Goal\n')
    await expect(store.newSurface({ attemptId: 'a', key: 'no-blocks', templatePath: noBlocks, surface: 'ws-no-blocks' }))
      .resolves.toMatchObject({ surface: 'ws-no-blocks' })
  })

  it('reconciles commit chains and handles concurrent immutable revision publication', async () => {
    const { root, template, store } = await fixture({ blocks: { result: 'result' } })
    const created = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    const head = JSON.parse(await readFile(join(surfaceRoot(store, 'ws-root'), 'HEAD.json'), 'utf8')) as { commitId: string }
    const internals = store as unknown as {
      reconcileCommit<T>(surface: ReturnType<typeof SurfaceId>, commitId: string): Promise<T | undefined>
      writeRevision(surface: ReturnType<typeof SurfaceId>, revision: Revision, snapshot: {
        surfaceDocument: string
        blocks: Map<ReturnType<typeof BlockId>, string>
      }): Promise<void>
      validateSnapshot(surface: ReturnType<typeof SurfaceId>, snapshot: {
        surfaceDocument: string
        blocks: Map<ReturnType<typeof BlockId>, string>
      }, parent: ReturnType<typeof SurfaceId> | null): Promise<void>
    }
    await expect(internals.reconcileCommit<NewSurfaceResult>(SurfaceId('ws-missing'), 'missing')).resolves.toBeUndefined()
    await expect(internals.reconcileCommit<NewSurfaceResult>(SurfaceId('ws-root'), head.commitId)).resolves.toEqual(created)
    await expect(internals.reconcileCommit<NewSurfaceResult>(SurfaceId('ws-root'), 'absent')).resolves.toBeUndefined()

    const originalHead = await readFile(join(surfaceRoot(store, 'ws-root'), 'HEAD.json'), 'utf8')
    await writeFile(join(surfaceRoot(store, 'ws-root'), 'HEAD.json'), '{')
    await expect(internals.reconcileCommit<NewSurfaceResult>(SurfaceId('ws-root'), 'absent'))
      .rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(join(surfaceRoot(store, 'ws-root'), 'HEAD.json'), originalHead)

    const commitPath = join(surfaceRoot(store, 'ws-root'), 'commits', `${head.commitId}.json`)
    const commitRecord = JSON.parse(await readFile(commitPath, 'utf8')) as Record<string, unknown>
    await writeFile(commitPath, JSON.stringify({ ...commitRecord, parentCommitId: head.commitId }))
    await expect(internals.reconcileCommit<NewSurfaceResult>(SurfaceId('ws-root'), 'absent'))
      .rejects.toMatchObject({ code: 'canonical-corrupt' })
    await writeFile(commitPath, JSON.stringify(commitRecord))

    const snapshot = await store.readSnapshot('ws-root')
    await expect(internals.validateSnapshot(SurfaceId('ws-root'), {
      surfaceDocument: snapshot.surfaceDocument.replace('surface_id: ws-root', 'surface_id: ws-other'),
      blocks: new Map(snapshot.blocks),
    }, null)).rejects.toMatchObject({ code: 'invalid-working-copy' })
    await expect(Promise.all([
      internals.writeRevision(SurfaceId('ws-copy'), snapshot.revision, {
        surfaceDocument: snapshot.surfaceDocument,
        blocks: new Map(snapshot.blocks),
      }),
      internals.writeRevision(SurfaceId('ws-copy'), snapshot.revision, {
        surfaceDocument: snapshot.surfaceDocument,
        blocks: new Map(snapshot.blocks),
      }),
    ])).resolves.toBeDefined()
    await expect(internals.writeRevision(SurfaceId('ws-copy'), snapshot.revision, {
      surfaceDocument: snapshot.surfaceDocument,
      blocks: new Map(snapshot.blocks),
    })).resolves.toBeUndefined()

    const brokenSurface = SurfaceId('ws-broken')
    await mkdir(surfaceRoot(store, brokenSurface), { recursive: true })
    await writeFile(join(surfaceRoot(store, brokenSurface), 'revisions'), 'not a directory')
    await expect(internals.writeRevision(brokenSurface, snapshot.revision, {
      surfaceDocument: snapshot.surfaceDocument,
      blocks: new Map(snapshot.blocks),
    })).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect((await readdir(join(surfaceRoot(store, 'ws-copy'), 'revisions')))).toContain(snapshot.revision.slice(7))
    expect(basename(root)).toContain('worksurface-store-defensive-')
  })
})
