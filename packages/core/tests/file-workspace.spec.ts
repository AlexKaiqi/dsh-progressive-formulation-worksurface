import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileWorkspace, WorkspaceProjectionError, type LockedFileWorkspace } from '../src/file-workspace.ts'
import { RevisionStore } from '../src/revision-store.ts'
import { sha256 } from '../src/hash.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(files: Record<string, string> = { 'a.txt': 'old-a', 'b.txt': 'old-b' }) {
  const root = await mkdtemp(join(tmpdir(), 'ws-files-')); roots.push(root)
  const work = join(root, 'work'); await mkdir(work)
  for (const [name, content] of Object.entries(files)) { await mkdir(join(work, name, '..'), { recursive: true }); await writeFile(join(work, name), content) }
  const state = join(root, 'state')
  const revisions = new RevisionStore(join(root, 'revisions'))
  const workspace = new FileWorkspace(work, state, revisions)
  const before = await workspace.snapshot()
  async function candidate(files: Record<string, string>) {
    const directory = join(root, `candidate-${Math.random().toString(36).slice(2)}`); await mkdir(directory)
    for (const [name, content] of Object.entries(files)) { await mkdir(join(directory, name, '..'), { recursive: true }); await writeFile(join(directory, name), content) }
    return (await revisions.snapshot(directory, 'artifact')).revision
  }
  return { root, work, state, revisions, workspace, before, candidate }
}

describe('host-neutral shared file workspace', () => {
  it('materializes through the shared writer with executable modes and preserves existing content', async () => {
    const f = await fixture()
    const source = join(f.root, 'import'); await mkdir(source)
    await writeFile(join(source, 'run.sh'), '#!/bin/sh\n'); await chmod(join(source, 'run.sh'), 0o755)
    const revision = (await f.revisions.snapshot(source, 'artifact')).revision
    await f.workspace.materialize(revision, 'exports/one', 'import-1')
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('old-a')
    expect((await lstat(join(f.work, 'exports/one/run.sh'))).mode & 0o111).not.toBe(0)
    await writeFile(join(f.work, 'exports/one/run.sh'), 'later draft')
    await f.workspace.materialize(revision, 'exports/one', 'import-1')
    expect(await readFile(join(f.work, 'exports/one/run.sh'), 'utf8')).toBe('later draft')
    await expect(f.workspace.materialize(revision, 'exports/one', 'import-2')).rejects.toMatchObject({ code: 'target-not-empty' })
    const outside = join(f.root, 'outside'); await mkdir(outside)
    await symlink(outside, join(f.work, 'escape'))
    await expect(f.workspace.materialize(revision, 'escape/new', 'import-3')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(await readdir(outside)).toEqual([])
    await expect(f.workspace.materialize(await f.candidate({}), 'empty', 'import-empty')).rejects.toMatchObject({ code: 'invalid-working-copy' })
  })


  it('keeps ordinary unpublished edits and reports fresh versions without resetting them', async () => {
    const f = await fixture()
    await writeFile(join(f.work, 'a.txt'), 'user draft')
    const result = await f.workspace.edit('edit-1', [{ path: 'a.txt', expectedVersion: `sha256:${sha256('old-a')}`, content: Buffer.from('agent edit') }])
    expect(result.status).toBe('conflict')
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('user draft')
    const after = await f.candidate({ 'a.txt': 'new-a', 'b.txt': 'old-b' })
    await expect(f.workspace.transaction(view => view.replace('', f.before, after, 'apply-1'))).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(await readdir(join(f.state, 'pending'))).toHaveLength(0)
  })

  it('commits a mixed edit with an absent deletion and durably reserves no-op identities', async () => {
    const f = await fixture()
    expect(await f.workspace.edit('mixed', [{ path: 'missing.txt', expectedVersion: 'absent', content: null }, { path: 'a.txt', expectedVersion: `sha256:${sha256('old-a')}`, content: Buffer.from('new-a') }])).toMatchObject({ status: 'committed' })
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('new-a')
    expect(await f.workspace.edit('noop', [{ path: 'missing.txt', expectedVersion: 'absent', content: null }])).toMatchObject({ status: 'unchanged' })
    const restarted = new FileWorkspace(f.work, f.state, f.revisions)
    await expect(restarted.edit('noop', [{ path: 'missing.txt', expectedVersion: 'absent', content: Buffer.from('different') }])).rejects.toMatchObject({ code: 'already-exists-conflict' })
  })

  it('resumes an interrupted projection from its durable intent', async () => {
    const f = await fixture()
    const after = await f.candidate({ 'a.txt': 'new-a', 'b.txt': 'new-b' })
    const original = f.revisions.readFile.bind(f.revisions)
    const fault = vi.spyOn(f.revisions, 'readFile').mockImplementation(async (revision, path) => { if (revision === after && path === 'b.txt') throw new Error('simulated storage interruption'); return original(revision, path) })
    await expect(f.workspace.transaction(view => view.replace('', f.before, after, 'interrupted'))).rejects.toBeInstanceOf(WorkspaceProjectionError)
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('new-a')
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
    expect(await readdir(join(f.state, 'pending'))).toHaveLength(1)
    fault.mockRestore()
    const observed = await f.workspace.observe()
    expect(observed).not.toBe(after)
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
    expect(await readdir(join(f.state, 'pending'))).toHaveLength(1)
    const restarted = new FileWorkspace(f.work, f.state, new RevisionStore(f.revisions.root))
    await restarted.recover()
    expect(await restarted.snapshot()).toBe(after)
    expect(await readdir(join(f.state, 'pending'))).toHaveLength(0)
  })

  it('refuses recovery before further writes when intervening user work exists', async () => {
    const f = await fixture()
    const after = await f.candidate({ 'a.txt': 'new-a', 'b.txt': 'new-b' })
    const original = f.revisions.readFile.bind(f.revisions)
    const fault = vi.spyOn(f.revisions, 'readFile').mockImplementation(async (revision, path) => { if (revision === after && path === 'a.txt') throw new Error('interruption'); return original(revision, path) })
    await expect(f.workspace.transaction(view => view.replace('', f.before, after, 'interrupted'))).rejects.toBeInstanceOf(WorkspaceProjectionError)
    fault.mockRestore()
    await writeFile(join(f.work, 'draft.txt'), 'new user work')
    await expect(f.workspace.recover()).rejects.toBeInstanceOf(WorkspaceProjectionError)
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('old-a')
    expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
    expect(await readFile(join(f.work, 'draft.txt'), 'utf8')).toBe('new user work')
  })

  it.each([
    [{ a: 'file' }, { 'a/b': 'nested' }],
    [{ 'a/b': 'nested' }, { a: 'file' }],
  ])('rejects file/directory conversions before writing any intent', async (before, after) => {
    const f = await fixture(before)
    const candidate = await f.candidate(after)
    await expect(f.workspace.transaction(view => view.replace('', f.before, candidate, 'topology'))).rejects.toMatchObject({ code: 'invalid-working-copy' })
    expect(await readdir(join(f.state, 'pending'))).toHaveLength(0)
    expect(await f.workspace.snapshot()).toBe(f.before)
  })

  it('drains admitted operations before release and rejects an escaped lease', async () => {
    const f = await fixture()
    let escaped!: LockedFileWorkspace
    await f.workspace.transaction(async view => {
      escaped = view
      void view.edit('unawaited', [{ path: 'a.txt', expectedVersion: `sha256:${sha256('old-a')}`, content: Buffer.from('new-a') }])
    })
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('new-a')
    await expect(escaped.snapshot()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it.each([null, [], { version: 1, operationId: 'malformed' }])('rejects malformed journal values as canonical corruption', async value => {
    const f = await fixture()
    await writeFile(join(f.state, 'pending', `${sha256('malformed')}.json`), JSON.stringify(value))
    await expect(f.workspace.recover()).rejects.toMatchObject({ code: 'canonical-corrupt' })
    expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('old-a')
  })

  it('allows only one same-version edit across two real processes', async () => {
    const f = await fixture({ 'a.txt': 'old-a' })
    const workspaceModule = new URL('../lib/types/file-workspace.js', import.meta.url).href
    const revisionModule = new URL('../lib/types/revision-store.js', import.meta.url).href
    const results = await Promise.all(['one', 'two'].map(async id => {
      const script = `import { FileWorkspace } from ${JSON.stringify(workspaceModule)};
        import { RevisionStore } from ${JSON.stringify(revisionModule)};
        const workspace = new FileWorkspace(${JSON.stringify(f.work)}, ${JSON.stringify(f.state)}, new RevisionStore(${JSON.stringify(f.revisions.root)}));
        const result = await workspace.edit(${JSON.stringify(id)}, [{ path: 'a.txt', expectedVersion: ${JSON.stringify(`sha256:${sha256('old-a')}`)}, content: Buffer.from(${JSON.stringify(id)}) }]);
        process.stdout.write(result.status);`
      const worker = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', error = ''
      worker.stdout.on('data', chunk => { output += String(chunk) }); worker.stderr.on('data', chunk => { error += String(chunk) })
      const [code] = await once(worker, 'close')
      if (code !== 0) throw new Error(error)
      return output
    }))
    expect(results.sort()).toEqual(['committed', 'conflict'])
    expect(['one', 'two']).toContain(await readFile(join(f.work, 'a.txt'), 'utf8'))
  })

  it('recovers a partially projected candidate after its writer process is killed', async () => {
    const f = await fixture()
    const after = await f.candidate({ 'a.txt': 'new-a', 'b.txt': 'new-b' })
    const workspaceModule = new URL('../lib/types/file-workspace.js', import.meta.url).href
    const revisionModule = new URL('../lib/types/revision-store.js', import.meta.url).href
    const script = `import { FileWorkspace } from ${JSON.stringify(workspaceModule)};
      import { RevisionStore } from ${JSON.stringify(revisionModule)};
      const revisions = new RevisionStore(${JSON.stringify(f.revisions.root)});
      const readFile = revisions.readFile.bind(revisions);
      revisions.readFile = async (revision, path) => {
        if (revision === ${JSON.stringify(after)} && path === 'b.txt') { process.stdout.write('partial'); setInterval(() => {}, 1000); await new Promise(() => {}); }
        return readFile(revision, path);
      };
      const workspace = new FileWorkspace(${JSON.stringify(f.work)}, ${JSON.stringify(f.state)}, revisions);
      await workspace.transaction(view => view.replace('', ${JSON.stringify(f.before)}, ${JSON.stringify(after)}, 'killed-writer'));`
    const worker = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(worker, 'close')
    try {
      await once(worker.stdout, 'data')
      expect(await readFile(join(f.work, 'a.txt'), 'utf8')).toBe('new-a')
      expect(await readFile(join(f.work, 'b.txt'), 'utf8')).toBe('old-b')
      worker.kill('SIGKILL'); await closed
      await f.workspace.recover()
      expect(await f.workspace.snapshot()).toBe(after)
      expect(await readdir(join(f.state, 'pending'))).toHaveLength(0)
    } finally { worker.kill('SIGKILL'); await closed }
  })
})
