import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asWorkSurfaceError,
  BlockId,
  deriveSurfaceId,
  hashSurfaceContent,
  instantiateBlockDocument,
  instantiateSurfaceDocument,
  parseBlockDocument,
  parseBlockReferences,
  parseFrontMatter,
  parseSurfaceDocument,
  sha256,
  stableStringify,
  SurfaceId,
  WorkSurfaceError,
} from '../src/index.ts'
import { EffectJournal } from '../src/journal.ts'
import { withRecoverableLock } from '../src/lock.ts'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation()
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`expected ${code}`)
}

describe('primitive formats', () => {
  it('normalizes errors and produces deterministic hashes and ids', () => {
    const stable = new WorkSurfaceError('not-found', 'missing', { id: 1 })
    expect(asWorkSurfaceError(stable)).toBe(stable)
    expect(asWorkSurfaceError(new Error('boom'))).toMatchObject({ code: 'effect-failed', message: 'boom' })
    expect(asWorkSurfaceError(42)).toMatchObject({ code: 'effect-failed', message: '42' })
    expect(sha256('abc')).toBe(sha256(Buffer.from('abc')))
    expect(stableStringify({ z: [{ b: 2, a: 1 }], a: null })).toBe('{"a":null,"z":[{"a":1,"b":2}]}')
    expect(hashSurfaceContent('surface', new Map([['z', 'Z'], ['a', 'A']])))
      .toBe(hashSurfaceContent('surface', new Map([['a', 'A'], ['z', 'Z']])))
    expect(SurfaceId('surface-1')).toBe('surface-1')
    expect(BlockId('block_1')).toBe('block_1')
    expectCode(() => SurfaceId(''), 'invalid-id')
    expectCode(() => BlockId('/bad'), 'invalid-id')
    expect(deriveSurfaceId('attempt', '  ')).toMatch(/^ws-surface-/)
    expect(deriveSurfaceId('attempt', 'Readable Key')).toMatch(/^ws-readable-key-/)
  })

  it('validates and instantiates Markdown envelopes and references', () => {
    const parsed = parseFrontMatter('---\r\nvalue: 1\r\n---\r\nbody', 'document')
    expect(parsed).toEqual({ data: { value: 1 }, body: 'body' })
    expectCode(() => parseFrontMatter('body', 'document'), 'invalid-markdown-envelope')
    expectCode(() => parseFrontMatter('---\na: [\n---\n', 'document'), 'invalid-markdown-envelope')
    for (const yaml of ['null', '[]', 'text']) {
      expectCode(() => parseFrontMatter(`---\n${yaml}\n---\n`, 'document'), 'invalid-markdown-envelope')
    }

    const surface = '---\nsurface_id: ws-root\nparent: null\nstatus: active\n---\nBody\n'
    expect(parseSurfaceDocument(surface)).toEqual({ surfaceId: 'ws-root', parent: null, status: 'active' })
    expect(parseSurfaceDocument('---\nsurface_id: ws-child\nparent: ws-root\nstatus: done\n---\n')).toMatchObject({ parent: 'ws-root' })
    for (const data of [
      'parent: null\nstatus: active',
      'surface_id: ws-root\nparent: 1\nstatus: active',
      'surface_id: ws-root\nparent: null\nstatus: ""',
    ]) {
      expectCode(() => parseSurfaceDocument(`---\n${data}\n---\n`), 'invalid-markdown-envelope')
    }

    const block = '---\nblock_id: result\nsurface_id: ws-root\nkind: result\nstatus: active\n---\nB\n'
    expect(parseBlockDocument(block)).toMatchObject({ blockId: 'result', surfaceId: 'ws-root', derivedFrom: [] })
    expect(parseBlockDocument(block.replace('status: active', 'status: active\nderived_from: [source]'), 'Result'))
      .toMatchObject({ derivedFrom: ['source'] })
    for (const data of [
      'surface_id: ws-root\nkind: result\nstatus: active',
      'block_id: result\nsurface_id: ws-root\nkind: ""\nstatus: active',
      'block_id: result\nsurface_id: ws-root\nkind: result\nstatus: active\nderived_from: bad',
    ]) {
      expectCode(() => parseBlockDocument(`---\n${data}\n---\n`), 'invalid-markdown-envelope')
    }

    const instantiatedSurface = instantiateSurfaceDocument('# Goal\n', SurfaceId('ws-new'), null)
    expect(parseSurfaceDocument(instantiatedSurface)).toMatchObject({ surfaceId: 'ws-new', status: 'active' })
    const preserved = instantiateSurfaceDocument(surface.replace('status: active', 'status: paused'), SurfaceId('ws-next'), SurfaceId('ws-root'))
    expect(parseSurfaceDocument(preserved)).toEqual({ surfaceId: 'ws-next', parent: 'ws-root', status: 'paused' })
    const blankStatus = instantiateSurfaceDocument(surface.replace('status: active', 'status: ""'), SurfaceId('ws-next'), null)
    expect(parseSurfaceDocument(blankStatus).status).toBe('active')
    const instantiatedBlock = instantiateBlockDocument(block, SurfaceId('ws-next'), 'renamed')
    expect(parseBlockDocument(instantiatedBlock)).toMatchObject({ blockId: 'renamed', surfaceId: 'ws-next' })

    expect(parseBlockReferences('a [[block:ws-root/one]] b [[block:ws-root/two]]'))
      .toEqual([{ surface: 'ws-root', block: 'one' }, { surface: 'ws-root', block: 'two' }])
    expect(parseBlockReferences('none')).toEqual([])
    expectCode(() => parseBlockReferences('[[block:ws-root/one/extra]]'), 'invalid-reference')
    expectCode(() => parseBlockReferences('[[block:ws-root/one]'), 'invalid-reference')
  })
})

describe('EffectJournal', () => {
  it('replays, rejects conflicts and failures, retries, and reconciles interrupted records', async () => {
    const root = await temporaryRoot('worksurface-journal-')
    const journal = new EffectJournal(root)
    let executions = 0
    const base = {
      attemptId: 'attempt-1', key: 'effect', type: 'test', request: { a: 1 },
      reconcile: async (): Promise<string | undefined> => undefined,
      execute: async () => { executions += 1; return 'done' },
    }
    await expect(journal.run(base)).resolves.toBe('done')
    await expect(journal.run(base)).resolves.toBe('done')
    expect(executions).toBe(1)
    await expect(journal.run({ ...base, request: { a: 2 } })).rejects.toMatchObject({ code: 'idempotency-key-conflict' })
    await expect(journal.run({ ...base, key: '' })).rejects.toMatchObject({ code: 'invalid-id' })
    await expect(journal.run({ ...base, attemptId: '../bad' })).rejects.toMatchObject({ code: 'invalid-id' })

    const failure = { ...base, key: 'failure', execute: async () => { throw new Error('failed once') } }
    await expect(journal.run(failure)).rejects.toMatchObject({ code: 'effect-failed' })
    await expect(journal.run(failure)).rejects.toMatchObject({ code: 'effect-failed', message: 'failed once' })
    await expect(journal.run({ ...failure, retry: true, execute: async () => 'recovered' })).resolves.toBe('recovered')

    const missingErrorKey = 'missing-error'
    const missingErrorPath = join(root, 'attempt-1', `${sha256(missingErrorKey)}.json`)
    await writeFile(missingErrorPath, `${JSON.stringify({
      attemptId: 'attempt-1', key: missingErrorKey, type: 'test',
      requestHash: sha256(stableStringify({ type: 'test', request: { a: 1 } })), status: 'failed',
    })}\n`)
    await expect(journal.run({ ...base, key: missingErrorKey })).rejects.toMatchObject({
      code: 'effect-failed', message: 'previous effect attempt failed', details: { originalCode: 'effect-failed' },
    })

    const interruptedKey = 'interrupted'
    const directory = join(root, 'attempt-1')
    await mkdir(directory, { recursive: true })
    const requestHash = sha256(stableStringify({ type: 'test', request: { a: 1 } }))
    const recordPath = join(directory, `${sha256(interruptedKey)}.json`)
    await writeFile(recordPath, `${JSON.stringify({
      attemptId: 'attempt-1', key: interruptedKey, type: 'test', requestHash, status: 'interrupted',
    })}\n`)
    await expect(journal.run({ ...base, key: interruptedKey, reconcile: async () => 'reconciled' })).resolves.toBe('reconciled')

    const startedKey = 'started'
    const startedPath = join(directory, `${sha256(startedKey)}.json`)
    await writeFile(startedPath, `${JSON.stringify({
      attemptId: 'attempt-1', key: startedKey, type: 'test', requestHash, status: 'started',
    })}\n`)
    await expect(journal.run({ ...base, key: startedKey, execute: async () => 'rerun' })).resolves.toBe('rerun')
    expect(JSON.parse(await readFile(startedPath, 'utf8'))).toMatchObject({ status: 'completed', result: 'rerun' })

    const corruptPath = join(directory, `${sha256('corrupt')}.json`)
    await writeFile(corruptPath, '{')
    await expect(journal.run({ ...base, key: 'corrupt' })).rejects.toMatchObject({ code: 'canonical-corrupt' })
  })
})

describe('recoverable lock', () => {
  it('serializes success and cleanup, reclaims dead owners, and preserves operation failures', async () => {
    const root = await temporaryRoot('worksurface-lock-')
    const path = join(root, 'lock')
    await expect(withRecoverableLock(path, async () => 'result')).resolves.toBe('result')
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(withRecoverableLock(path, async () => { throw new Error('operation') })).rejects.toThrow('operation')
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(path, '99999999\n')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) })
    await expect(withRecoverableLock(path, async () => 'reclaimed')).resolves.toBe('reclaimed')

    await mkdir(path)
    await expect(withRecoverableLock(path, async () => 'never')).rejects.toMatchObject({ code: 'EISDIR' })
    await expect(withRecoverableLock(join(root, 'missing', 'lock'), async () => 'never')).rejects.toMatchObject({ code: 'ENOENT' })

    const dangling = join(root, 'dangling-lock')
    await symlink(join(root, 'absent-owner'), dangling)
    await expect(withRecoverableLock(dangling, async () => 'reclaimed-dangling')).resolves.toBe('reclaimed-dangling')
  })

  it('waits for a live owner and times out', async () => {
    const root = await temporaryRoot('worksurface-live-lock-')
    const path = join(root, 'lock')
    await writeFile(path, `${process.pid}\n`)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10_001)
    await expect(withRecoverableLock(path, async () => 'never'))
      .rejects.toThrow('timed out waiting for live WorkSurface lock')

    await writeFile(path, 'invalid-pid\n')
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001)
    await expect(withRecoverableLock(path, async () => 'never'))
      .rejects.toThrow('timed out waiting for live WorkSurface lock')
  })
})
