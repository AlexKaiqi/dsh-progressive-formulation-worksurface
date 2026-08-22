import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import {
  BlockId,
  createBlockRef,
  ProjectionCompiler,
  SurfaceId,
  WorkSurfaceError,
  WorkSurfaceStore,
} from '../src/index.ts'
import type { Revision } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(blocks: Record<string, string> = {}): Promise<{ root: string; template: string; store: WorkSurfaceStore }> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-core-'))
  roots.push(root)
  const template = join(root, 'template')
  await mkdir(join(template, 'blocks'), { recursive: true })
  await writeFile(join(template, 'surface.md'), '# Goal\n\nInitial goal.\n', 'utf8')
  for (const [id, body] of Object.entries(blocks)) {
    await writeFile(join(template, 'blocks', `${id}.md`), block(id, 'template', body), 'utf8')
  }
  const store = new WorkSurfaceStore({ root: join(root, 'store') })
  return { root, template, store }
}

function block(id: string, surface: string, body: string, status = 'candidate'): string {
  return `---\nblock_id: ${id}\nsurface_id: ${surface}\nkind: evidence\nstatus: ${status}\nderived_from: []\n---\n${body}\n`
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(WorkSurfaceError)
  expect((error as WorkSurfaceError).code).toBe(code)
}

describe('WorkSurfaceStore', () => {
  test('creates, checks out, commits, and replays content-addressed state', async () => {
    const { root, template, store } = await fixture({ evidence: '# Finding\n\nB' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create-root', templatePath: template, surface: 'ws-root' })
    const checkoutPath = join(root, 'working copy')
    const checkedOut = await store.checkout({ surface: 'ws-root', targetPath: checkoutPath })
    expect(checkedOut.revision).toBe(created.revision)
    const surfacePath = join(checkoutPath, 'surface.md')
    await writeFile(surfacePath, `${await readFile(surfacePath, 'utf8')}\n[[block:ws-root/evidence]]\n`, 'utf8')
    const committed = await store.commit({
      attemptId: 'a1',
      key: 'attach-evidence',
      workingPath: checkoutPath,
      baseRevision: checkedOut.revision,
    })
    expect(committed.revision).not.toBe(created.revision)
    const replay = await store.commit({
      attemptId: 'a1',
      key: 'attach-evidence',
      workingPath: checkoutPath,
      baseRevision: checkedOut.revision,
    })
    expect(replay).toEqual(committed)
    expect((await store.history('ws-root')).filter(record => record.effect.key === 'attach-evidence')).toHaveLength(1)
  })

  test('reports Surface existence without replaying Work Session events', async () => {
    const { template, store } = await fixture()
    expect(await store.hasSurface('ws-root')).toBe(false)
    await store.newSurface({ attemptId: 'a1', key: 'create-root', templatePath: template, surface: 'ws-root' })
    expect(await store.hasSurface('ws-root')).toBe(true)
    await expectCode(store.hasSurface('missing/slash'), 'invalid-id')
  })

  test('rejects dangling refs without changing canonical revision', async () => {
    const { root, template, store } = await fixture()
    const created = await store.newSurface({ attemptId: 'a1', key: 'create-root', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    const path = join(working, 'surface.md')
    await writeFile(path, `${await readFile(path, 'utf8')}\n[[block:ws-root/missing]]\n`, 'utf8')
    await expectCode(store.commit({
      attemptId: 'a1', key: 'bad-ref', workingPath: working, baseRevision: created.revision,
    }), 'dangling-reference')
    expect((await store.readHead('ws-root')).revision).toBe(created.revision)
  })

  test('fails closed on stale base revisions', async () => {
    const { root, template, store } = await fixture()
    const created = await store.newSurface({ attemptId: 'a1', key: 'create-root', templatePath: template, surface: 'ws-root' })
    const left = join(root, 'left')
    const right = join(root, 'right')
    await store.checkout({ surface: 'ws-root', targetPath: left })
    await store.checkout({ surface: 'ws-root', targetPath: right })
    await writeFile(join(left, 'surface.md'), `${await readFile(join(left, 'surface.md'), 'utf8')}\nleft\n`, 'utf8')
    await writeFile(join(right, 'surface.md'), `${await readFile(join(right, 'surface.md'), 'utf8')}\nright\n`, 'utf8')
    await store.commit({ attemptId: 'a1', key: 'left', workingPath: left, baseRevision: created.revision })
    await expectCode(store.commit({ attemptId: 'a1', key: 'right', workingPath: right, baseRevision: created.revision }), 'revision-conflict')
  })

  test('rejects idempotency-key reuse with different arguments', async () => {
    const { root, template, store } = await fixture()
    await store.newSurface({ attemptId: 'a1', key: 'same', templatePath: template, surface: 'ws-one' })
    await expectCode(store.newSurface({ attemptId: 'a1', key: 'same', templatePath: template, surface: 'ws-two' }), 'idempotency-key-conflict')
    expect(await readdirSurfaceNames(store)).toEqual(['ws-one'])
    expect(root).toBeTruthy()
  })

  test('forbids physical Block deletion while allowing orphan Blocks', async () => {
    const { root, template, store } = await fixture({ evidence: 'evidence' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    await rm(join(working, 'blocks', 'evidence.md'))
    await expectCode(store.commit({ attemptId: 'a1', key: 'delete', workingPath: working, baseRevision: created.revision }), 'physical-delete-forbidden')
  })

  test('fails closed on unexpected paths, symbolic links, and invalid UTF-8', async () => {
    const { root, template, store } = await fixture({ evidence: 'evidence' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })

    await writeFile(join(working, 'unexpected.txt'), 'not part of the protocol')
    await expectCode(store.commit({ attemptId: 'a1', key: 'unexpected', workingPath: working, baseRevision: created.revision }), 'invalid-working-copy')
    await rm(join(working, 'unexpected.txt'))

    await symlink(join(working, 'surface.md'), join(working, 'blocks', 'linked.md'))
    await expectCode(store.commit({ attemptId: 'a1', key: 'symlink', workingPath: working, baseRevision: created.revision }), 'invalid-working-copy')
    await rm(join(working, 'blocks', 'linked.md'))

    await writeFile(join(working, 'blocks', 'evidence.md'), Buffer.from([0xff, 0xfe]))
    await expectCode(store.commit({ attemptId: 'a1', key: 'utf8', workingPath: working, baseRevision: created.revision }), 'invalid-working-copy')
    expect((await store.readHead('ws-root')).revision).toBe(created.revision)
  })

  test('validates exact committed child output refs', async () => {
    const { template, store } = await fixture({ result: 'committed result' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-child' })
    await expect(store.validateOutputRefs([createBlockRef('ws-child', 'result', created.revision)])).resolves.toBeUndefined()
    await expectCode(store.validateOutputRefs([createBlockRef('ws-child', 'missing', created.revision)]), 'dangling-reference')
    const falseRevision: Revision = `sha256:${'0'.repeat(64)}`
    await expectCode(store.validateOutputRefs([createBlockRef('ws-child', 'result', falseRevision)]), 'not-found')
  })
})

describe('ProjectionCompiler', () => {
  test('collects complete direct-reference files in order and records exact revisions', async () => {
    const { root, template, store } = await fixture({
      b1: 'first [[block:ws-root/b3]]',
      b2: 'second',
      b3: 'must not recursively expand',
      orphan: 'must not appear',
    })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    const surfacePath = join(working, 'surface.md')
    await writeFile(
      surfacePath,
      `${await readFile(surfacePath, 'utf8')}\nA\n[[block:ws-root/b1]]\nB\n[[block:ws-root/b2]]\n[[block:ws-root/b1]]\n`,
      'utf8',
    )
    const committed = await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })

    expect(projection.surfaceRevision).toBe(committed.revision)
    expect(projection.blockRevisions.map(ref => ref.block)).toEqual([BlockId('b1'), BlockId('b2'), BlockId('b1')])
    expect(projection.files.map(file => file.relativePath)).toEqual(['surface.md', 'blocks/b1.md', 'blocks/b2.md'])
    expect(projection.files[0]?.content).toContain('[[block:ws-root/b1]]')
    expect(projection.files[1]?.content).toContain('first [[block:ws-root/b3]]')
    expect(projection.files[2]?.content).toContain('second')
    expect(projection.files.some(file => file.content.includes('must not recursively expand'))).toBe(false)
    expect(projection.files.some(file => file.content.includes('must not appear'))).toBe(false)
    expect(projection.files.every(file => file.writable)).toBe(true)
    expect(projection.omittedFiles).toEqual([])
    expect(projection.surfaceId).toBe(SurfaceId('ws-root'))
  })

  test('keeps the complete Surface and omits an oversized Block as a whole', async () => {
    const { root, template, store } = await fixture({ large: 'x'.repeat(1_000) })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    const surfacePath = join(working, 'surface.md')
    await writeFile(surfacePath, `${await readFile(surfacePath, 'utf8')}\n[[block:ws-root/large]]\n`, 'utf8')
    await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })

    const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-root', profile: 'research', tokenBudget: 80 })
    expect(projection.files).toHaveLength(1)
    expect(projection.files[0]?.relativePath).toBe('surface.md')
    expect(projection.files[0]?.content).toContain('[[block:ws-root/large]]')
    expect(projection.omittedFiles).toHaveLength(1)
    expect(projection.omittedFiles[0]).toMatchObject({
      blockId: BlockId('large'),
      reason: 'token-budget',
      writable: true,
    })
    expect(projection.files.some(file => file.content.includes('x'.repeat(1_000)))).toBe(false)
    expect(projection.budgetExceeded).toBe(true)
  })

  test('pins cross-Surface Blocks as read-only and rebuilds an earlier Projection exactly', async () => {
    const { root, template, store } = await fixture({ evidence: 'source v1' })
    const source = await store.newSurface({ attemptId: 'a1', key: 'source', templatePath: template, surface: 'ws-source' })
    await writeFile(join(template, 'surface.md'), '# Root\n\n[[block:ws-source/evidence]]\n')
    const rootSurface = await store.newSurface({ attemptId: 'a1', key: 'root', templatePath: template, surface: 'ws-root' })
    const compiler = new ProjectionCompiler(store)
    const first = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(first.blockRevisions).toEqual([createBlockRef('ws-source', 'evidence', source.revision)])
    expect(first.files[1]).toMatchObject({
      surfaceId: SurfaceId('ws-source'),
      blockId: BlockId('evidence'),
      writable: false,
    })
    expect(first.files[1]?.content).toContain('source v1')

    const sourceWorking = join(root, 'source-working')
    await store.checkout({ surface: 'ws-source', targetPath: sourceWorking })
    const sourceBlock = join(sourceWorking, 'blocks', 'evidence.md')
    await writeFile(sourceBlock, (await readFile(sourceBlock, 'utf8')).replace('source v1', 'source v2'))
    await store.commit({ attemptId: 'a1', key: 'source-v2', workingPath: sourceWorking, baseRevision: source.revision })
    const current = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(current.files[1]?.content).toContain('source v2')

    const rebuilt = await compiler.compilePinned({
      surface: 'ws-root',
      revision: rootSurface.revision,
      blockRevisions: first.blockRevisions,
      profile: 'research',
      tokenBudget: 10_000,
    })
    expect(rebuilt.files).toEqual(first.files)
    expect(rebuilt.omittedFiles).toEqual(first.omittedFiles)
    expect(rebuilt.blockRevisions).toEqual(first.blockRevisions)
  })

  test('rejects invalid Projection options and mismatched pins', async () => {
    const { root, template, store } = await fixture({ result: 'x'.repeat(1_000) })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    const surfacePath = join(working, 'surface.md')
    await writeFile(surfacePath, `${await readFile(surfacePath, 'utf8')}\n[[block:ws-root/result]]\n`)
    const committed = await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const compiler = new ProjectionCompiler(store)

    for (const tokenBudget of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(compiler.compile({ surface: 'ws-root', profile: 'test', tokenBudget }))
        .rejects.toMatchObject({ code: 'invalid-working-copy' })
    }
    await expect(compiler.compile({ surface: 'ws-root', profile: ' ', tokenBudget: 10 }))
      .rejects.toMatchObject({ code: 'unsupported-profile' })
    await expect(compiler.compilePinned({
      surface: 'ws-root', revision: committed.revision, profile: 'test', tokenBudget: 100, blockRevisions: [],
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(compiler.compilePinned({
      surface: 'ws-root', revision: committed.revision, profile: 'test', tokenBudget: 100,
      blockRevisions: [createBlockRef('ws-other', 'result', committed.revision)],
    })).rejects.toMatchObject({ code: 'invalid-reference' })

    const partial = await compiler.compile({ surface: 'ws-root', profile: 'test', tokenBudget: 130 })
    expect(partial.files.map(file => file.relativePath)).toEqual(['surface.md'])
    expect(partial.omittedFiles.map(file => file.relativePath)).toEqual(['blocks/result.md'])
    expect(partial.omittedFiles[0]?.reason).toBe('token-budget')
  })

  test('serves memoized Projections for an unchanged revision with a fresh observation time', async () => {
    const { root, template, store } = await fixture({ evidence: 'cached evidence' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    await writeFile(join(working, 'surface.md'), `${await readFile(join(working, 'surface.md'), 'utf8')}\n[[block:ws-root/evidence]]\n`)
    await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const compiler = new ProjectionCompiler(store)
    const first = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    const second = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(second.files).toEqual(first.files)
    expect(second.omittedFiles).toEqual(first.omittedFiles)
    expect(second.blockRevisions).toEqual(first.blockRevisions)
    expect(second.createdAt).not.toBe(first.createdAt)

    // A memoized Projection is the exact immutable revision it names: tampering
    // the canonical file does not change the verified content already pinned.
    const revisionRoot = join(store.canonicalRoot, 'surfaces', 'ws-root', 'revisions', created.revision.slice('sha256:'.length))
    const revisionSurface = join(revisionRoot, 'surface.md')
    await writeFile(revisionSurface, `${await readFile(revisionSurface, 'utf8')}\ntamper\n`)
    const third = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(third.files).toEqual(first.files)
    expect(third.files[0]?.content).not.toContain('tamper')
  })

  test('evicts bounded memo entries without losing correctness', async () => {
    const { root, template, store } = await fixture({ evidence: 'eviction evidence' })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const compiler = new ProjectionCompiler(store, { maxSnapshots: 1, maxProjections: 1 })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    await writeFile(join(working, 'surface.md'), `${await readFile(join(working, 'surface.md'), 'utf8')}\n[[block:ws-root/evidence]]\n`)
    const committed = await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const second = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(second.surfaceRevision).toBe(committed.revision)
    expect(second.files.some(file => file.content.includes('[[block:ws-root/evidence]]'))).toBe(true)

    // The earlier revision was evicted; recompiling it re-reads canonical content.
    const rebuilt = await compiler.compile({
      surface: 'ws-root', profile: 'research', tokenBudget: 10_000, revision: created.revision,
    })
    expect(rebuilt.surfaceRevision).toBe(created.revision)
    expect(rebuilt.files[0]?.content).not.toContain('[[block:ws-root/evidence]]')
    expect(rebuilt.files).not.toEqual(second.files)
  })
})

async function readdirSurfaceNames(store: WorkSurfaceStore): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return (await readdir(join(store.canonicalRoot, 'surfaces'))).sort()
}
