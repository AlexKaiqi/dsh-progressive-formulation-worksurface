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
  test('expands only direct refs in order and records exact revisions', async () => {
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
    await writeFile(surfacePath, `${await readFile(surfacePath, 'utf8')}\nA\n[[block:ws-root/b1]]\nB\n[[block:ws-root/b2]]\n`, 'utf8')
    const committed = await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(projection.surfaceRevision).toBe(committed.revision)
    expect(projection.blockRevisions.map(ref => ref.block)).toEqual([BlockId('b1'), BlockId('b2')])
    expect(projection.renderedContent.indexOf('first')).toBeLessThan(projection.renderedContent.indexOf('\nB\n'))
    expect(projection.renderedContent).not.toContain('must not recursively expand')
    expect(projection.renderedContent).not.toContain('must not appear')
    expect(projection.surfaceId).toBe(SurfaceId('ws-root'))
  })

  test('keeps the full Surface and original ref when a Block is truncated', async () => {
    const { root, template, store } = await fixture({ large: 'x'.repeat(1_000) })
    const created = await store.newSurface({ attemptId: 'a1', key: 'create', templatePath: template, surface: 'ws-root' })
    const working = join(root, 'working')
    await store.checkout({ surface: 'ws-root', targetPath: working })
    const surfacePath = join(working, 'surface.md')
    await writeFile(surfacePath, `${await readFile(surfacePath, 'utf8')}\n[[block:ws-root/large]]\n`, 'utf8')
    await store.commit({ attemptId: 'a1', key: 'attach', workingPath: working, baseRevision: created.revision })
    const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-root', profile: 'research', tokenBudget: 80 })
    expect(projection.renderedContent).toContain('[[block:ws-root/large]]')
    expect(projection.renderedContent).not.toContain('x'.repeat(1_000))
  })

  test('pins cross-Surface Blocks and rebuilds an earlier Projection exactly', async () => {
    const { root, template, store } = await fixture({ evidence: 'source v1' })
    const source = await store.newSurface({ attemptId: 'a1', key: 'source', templatePath: template, surface: 'ws-source' })
    await writeFile(join(template, 'surface.md'), '# Root\n\n[[block:ws-source/evidence]]\n')
    const rootSurface = await store.newSurface({ attemptId: 'a1', key: 'root', templatePath: template, surface: 'ws-root' })
    const compiler = new ProjectionCompiler(store)
    const first = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(first.blockRevisions).toEqual([createBlockRef('ws-source', 'evidence', source.revision)])
    expect(first.renderedContent).toContain('source v1')

    const sourceWorking = join(root, 'source-working')
    await store.checkout({ surface: 'ws-source', targetPath: sourceWorking })
    const sourceBlock = join(sourceWorking, 'blocks', 'evidence.md')
    await writeFile(sourceBlock, (await readFile(sourceBlock, 'utf8')).replace('source v1', 'source v2'))
    await store.commit({ attemptId: 'a1', key: 'source-v2', workingPath: sourceWorking, baseRevision: source.revision })
    const current = await compiler.compile({ surface: 'ws-root', profile: 'research', tokenBudget: 10_000 })
    expect(current.renderedContent).toContain('source v2')

    const rebuilt = await compiler.compilePinned({
      surface: 'ws-root',
      revision: rootSurface.revision,
      blockRevisions: first.blockRevisions,
      profile: 'research',
      tokenBudget: 10_000,
    })
    expect(rebuilt.renderedContent).toBe(first.renderedContent)
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
    expect(partial.renderedContent).toContain('[truncated by Projection budget')
    expect(partial.renderedContent).toContain('xxx')
  })
})

async function readdirSurfaceNames(store: WorkSurfaceStore): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return (await readdir(join(store.canonicalRoot, 'surfaces'))).sort()
}
