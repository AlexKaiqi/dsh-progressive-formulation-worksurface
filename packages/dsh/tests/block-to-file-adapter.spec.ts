import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { FileWorkspace, RevisionStore, type Revision } from '@pf-worksurface/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBlockToFileAdapter, WorkSurfaceBlockToFileBackend, type BlockToFileContext } from '../src/block-to-file-adapter.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ws-b2f-adapter-')); roots.push(root)
  const work = join(root, 'work'); await mkdir(work)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(work, path, '..'), { recursive: true })
    await writeFile(join(work, path), content)
  }
  const state = join(root, 'state')
  const revisions = new RevisionStore(join(state, 'revisions'))
  const workspace = new FileWorkspace(work, join(state, 'workspace'), revisions)
  const backend = new WorkSurfaceBlockToFileBackend(workspace)
  const context: BlockToFileContext = { root: work, scope: 'worksurface-authoring', agentId: 'agent-a' }
  return { root, work, state, revisions, workspace, backend, context }
}

async function request(f: Awaited<ReturnType<typeof fixture>>, files: Record<string, string | null>, transactionId = 'message-1', context = f.context) {
  const revision = await f.backend.captureSnapshot(context)
  return { ...context, transactionId, changes: await Promise.all(Object.entries(files).map(async ([path, content]) => ({
    path, content, expectedVersion: (await f.backend.readFile(context, revision, path)).fileVersion,
    result: { path, mode: content === null ? 'delete' : 'write', status: content === null ? 'deleted' : 'updated',
      lines: 1, added: 1, removed: 0, diffText: null, editFormat: null, editsProposed: 0, editsApplied: 0, fuzz: 0 },
  }))) }
}

describe('optional b2f file backend', () => {
  it('writes ordinary Surface and orchestration drafts without publishing or creating a second store', async () => {
    const f = await fixture()
    const proposal = await request(f, { 'surfaces/new/surface.md': '# Draft\n', 'orchestrations/flow/artifact/main.js': 'export default () => []\n' })
    const report = await f.backend.commit(proposal)
    expect(report.status).toBe('committed')
    expect(await readFile(join(f.work, 'surfaces/new/surface.md'), 'utf8')).toBe('# Draft\n')
    expect(await readFile(join(f.work, 'orchestrations/flow/artifact/main.js'), 'utf8')).toBe('export default () => []\n')
    expect(await readdir(f.state)).toEqual(expect.arrayContaining(['workspace', 'revisions']))
    expect(existsSync(join(f.state, 'events'))).toBe(false)
    expect(existsSync(`${f.work}.b2f-git`)).toBe(false)
    expect(report.results).toEqual(proposal.changes.map(change => change.result))
    expect(await f.backend.readFile(f.context, report.repoRevision!, 'surfaces/new/surface.md')).toMatchObject({
      fileVersion: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), content: '# Draft\n',
    })
  })

  it('returns fresh immutable files on conflict, withholds siblings, and accepts a considered retry', async () => {
    const f = await fixture({ 'a.txt': 'before\n' })
    const proposal = await request(f, { 'a.txt': 'proposed\n', 'b.txt': 'withheld\n' })
    await writeFile(join(f.work, 'a.txt'), 'user draft\n')
    const rejected = await f.backend.commit(proposal)
    expect(rejected.status).toBe('stale')
    expect(rejected.staleFiles).toEqual([expect.objectContaining({
      path: 'a.txt', content: 'user draft\n', observedVersion: proposal.changes[0]!.expectedVersion,
      fileVersion: expect.stringMatching(/^sha256:/), repoRevision: rejected.repoRevision,
    })])
    expect(existsSync(join(f.work, 'b.txt'))).toBe(false)
    expect(await f.backend.readFile(f.context, rejected.repoRevision!, 'a.txt')).toMatchObject({ content: 'user draft\n' })
    const retry = await request(f, { 'a.txt': 'considered merge\n', 'b.txt': 'accepted\n' }, 'message-2')
    expect((await f.backend.commit(retry)).status).toBe('committed')
  })

  it('deduplicates exact replays across adapter restart and namespaces message ids by Agent', async () => {
    const f = await fixture()
    const first = await request(f, { 'a.txt': 'one\n' }, 'same-message')
    expect((await f.backend.commit(first)).status).toBe('committed')
    const restarted = new WorkSurfaceBlockToFileBackend(new FileWorkspace(f.work, f.workspace.stateRoot, new RevisionStore(f.revisions.root)))
    expect((await restarted.commit(first)).status).toBe('unchanged')
    const second = await request(f, { 'a.txt': 'two\n' }, 'same-message', { ...f.context, agentId: 'agent-b' })
    expect((await restarted.commit(second)).status).toBe('committed')
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('two\n')
    const replay = await restarted.commit(first)
    expect(replay.status).toBe('stale')
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('two\n')
  })

  it('reports accepted projection failure, observes without recovery, then recovers on preparation', async () => {
    const f = await fixture({ 'a.txt': 'old-a', 'b.txt': 'old-b' })
    const before = await f.backend.captureSnapshot(f.context)
    const proposal = await request(f, { 'a.txt': 'new-a', 'b.txt': 'new-b' })
    const original = f.revisions.readFile.bind(f.revisions)
    const fault = vi.spyOn(f.revisions, 'readFile').mockImplementation(async (revision, path) => {
      if (revision !== before && path === 'b.txt') throw new Error('storage interruption')
      return original(revision, path)
    })
    const report = await f.backend.commit(proposal)
    expect(report.status).toBe('projection-failed')
    expect(report.commit).toBe(report.repoRevision)
    expect(report.repoRevision).toMatch(/^sha256:/)
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('new-a')
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
    fault.mockRestore()
    const observed = await f.backend.head(f.context)
    expect(observed).not.toBe(report.repoRevision)
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
    expect(await readdir(join(f.workspace.stateRoot, 'pending'))).toHaveLength(1)
    const restarted = new WorkSurfaceBlockToFileBackend(new FileWorkspace(f.work, f.workspace.stateRoot, f.revisions))
    expect(await restarted.captureSnapshot(f.context)).toBe(report.repoRevision)
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('new-b')
  })

  it('preserves exact UTF-8 including BOM and refuses lossy binary observations', async () => {
    const f = await fixture({ 'bom.txt': '\uFEFFhello\r\n' })
    await writeFile(join(f.work, 'binary.dat'), Buffer.from([0xff, 0xfe]))
    const revision = await f.backend.captureSnapshot(f.context)
    expect((await f.backend.readFile(f.context, revision, 'bom.txt')).content).toBe('\uFEFFhello\r\n')
    await expect(f.backend.readFile(f.context, revision, 'binary.dat')).rejects.toThrow('valid UTF-8')
    expect(() => f.backend.head({ ...f.context, root: f.root })).toThrow('authoring root')
  })
})

type Resolver = (agent?: { session: { id: string; header: { cwd?: string } } }, session?: { id: string; header: { cwd?: string } }, paths?: readonly string[]) => { root: string; backend: WorkSurfaceBlockToFileBackend } | undefined
class FixtureB2F extends Service {
  readonly backendProtocolVersion: number | undefined = 1
  readonly resolvers: Resolver[] = []
  constructor(ctx: Context) { super(ctx, 'b2f') }
  registerRootResolver(resolver: Resolver) {
    this.resolvers.push(resolver)
    return () => { const index = this.resolvers.indexOf(resolver); if (index >= 0) this.resolvers.splice(index, 1) }
  }
}
class LegacyFixtureB2F extends FixtureB2F { override readonly backendProtocolVersion = undefined }

describe('optional Cordis attachment', () => {
  it('fails closed for an old resolver-only b2f service instead of allowing its Git fallback', async () => {
    const f = await fixture()
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(LegacyFixtureB2F)
    await ctx.plugin(inner => installBlockToFileAdapter(inner, f.workspace,
      { workRoot: f.work, bindingForSession: () => undefined }))
    const b2f = ctx.get('b2f') as LegacyFixtureB2F
    await vi.waitFor(() => expect(b2f.resolvers).toHaveLength(1))
    const resolver = b2f.resolvers[0]!
    const fallback = vi.fn()
    expect(() => resolver(undefined, { id: 'ordinary', header: { cwd: f.work } }, ['a.txt']) ?? fallback())
      .toThrow('backend protocol 1')
    expect(fallback).not.toHaveBeenCalled()
    expect(resolver(undefined, { id: 'other', header: { cwd: f.root } }, ['a.txt'])).toBeUndefined()
    expect(existsSync(`${f.work}.b2f-git`)).toBe(false)
  })
  it('starts without b2f, attaches on availability, routes only owned Sessions and disposes its resolver', async () => {
    const f = await fixture()
    const ctx = new Context(); contexts.push(ctx)
    const sessions = { workRoot: f.work, bindingForSession: vi.fn((id: string) => id === 'bound' ? {
      version: 1 as const, surfaceId: 'owned', sessionId: id, inputSource: 'authoring' as const,
      inputRevision: `sha256:${'1'.repeat(64)}` as Revision, expectedHead: null,
    } : undefined) }
    const owner = ctx.plugin(inner => installBlockToFileAdapter(inner, f.workspace, sessions))
    await owner
    expect(ctx.get('b2f')).toBeUndefined()
    await ctx.plugin(FixtureB2F)
    const b2f = ctx.get('b2f') as FixtureB2F
    await vi.waitFor(() => expect(b2f.resolvers).toHaveLength(1))
    const resolve = b2f.resolvers[0]!
    const normal = resolve(undefined, { id: 'ordinary', header: { cwd: f.work } }, ['surfaces/new/surface.md'])
    expect(normal).toMatchObject({ root: f.work, scope: 'worksurface-authoring', authorization: 'mounted-workspace' })
    const bound = resolve(undefined, { id: 'bound', header: { cwd: f.work } })
    expect(bound?.backend).toBe(normal?.backend)
    expect(resolve(undefined, { id: 'bound', header: { cwd: join(f.state, 'legacy-worktree') } })).toBeUndefined()
    expect(resolve(undefined, { id: 'bound', header: {} })).toBeUndefined()
    expect(resolve(undefined, { id: 'other', header: { cwd: f.root } }, ['a.txt'])).toBeUndefined()
    expect(resolve()).toBeUndefined()
    await owner.dispose()
    expect(b2f.resolvers).toHaveLength(0)
  })
})
