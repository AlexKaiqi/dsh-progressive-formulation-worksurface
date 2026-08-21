import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { WorkSurfaceError, WorkSurfaceStore } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; store: WorkSurfaceStore; template: string }> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-session-'))
  roots.push(root)
  const template = join(root, 'template')
  await mkdir(join(template, 'blocks'), { recursive: true })
  await writeFile(join(template, 'surface.md'), '# Work\n')
  return { root, store: new WorkSurfaceStore({ root: join(root, 'store') }), template }
}

describe('Surface-local Work Session', () => {
  test('stores sibling Surfaces with recursive parent facts and no canonical graph index', async () => {
    const { root, store, template } = await fixture()
    const parent = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    const child = await store.newSurface({ attemptId: 'a', key: 'child', templatePath: template, surface: 'ws-child', parent: 'ws-root' })

    const surfacesRoot = join(root, 'store', 'canonical', 'surfaces')
    expect((await readdir(surfacesRoot)).sort()).toEqual(['ws-child', 'ws-root'])
    expect(await store.readWorkSession('ws-child')).toMatchObject({
      header: { surfaceId: 'ws-child', parentSurfaceId: 'ws-root' },
      events: [{ seq: 0, type: 'surface/created', data: { revision: child.revision } }],
    })
    expect((await store.readWorkSession('ws-root')).events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'child/created',
        data: { childSurfaceId: 'ws-child', initialRevision: child.revision },
      }),
    ]))
    expect(parent.surface).toBe('ws-root')
  })

  test('records revisions and repairs the materialized Session head from canonical events', async () => {
    const { root, store, template } = await fixture()
    const created = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    const checkout = join(root, 'checkout')
    await store.checkout({ surface: 'ws-root', targetPath: checkout })
    const surfaceDocument = await readFile(join(checkout, 'surface.md'), 'utf8')
    await writeFile(join(checkout, 'surface.md'), `${surfaceDocument}\nChanged.\n`)
    const committed = await store.commit({ attemptId: 'a', key: 'commit', workingPath: checkout, baseRevision: created.revision })
    expect((await store.readWorkSession('ws-root')).events.at(-1)).toMatchObject({
      type: 'surface/revision-published',
      data: { previousRevision: created.revision, revision: committed.revision },
    })

    const session = await store.readWorkSession('ws-root')
    const creation = session.events.find(event => event.type === 'surface/created')
    const publication = session.events.find(event => event.type === 'surface/revision-published')
    const surfaceHead = join(root, 'store', 'canonical', 'surfaces', 'ws-root', 'HEAD.json')
    await writeFile(surfaceHead, JSON.stringify({
      revision: created.revision,
      commitId: (creation?.data as { commitId: string }).commitId,
    }))
    await expect(store.readHead('ws-root')).resolves.toEqual({
      revision: committed.revision,
      commitId: (publication?.data as { commitId: string }).commitId,
    })
    expect(JSON.parse(await readFile(surfaceHead, 'utf8'))).toEqual({
      revision: committed.revision,
      commitId: (publication?.data as { commitId: string }).commitId,
    })

    const head = join(root, 'store', 'canonical', 'surfaces', 'ws-root', 'session', 'HEAD.json')
    await unlink(head)
    const repaired = await store.readWorkSession('ws-root')
    expect(JSON.parse(await readFile(head, 'utf8'))).toEqual({
      seq: repaired.events.at(-1)?.seq,
      eventId: repaired.events.at(-1)?.eventId,
    })
  })

  test('folds Agent bindings from events and records the direct child boundary in the parent', async () => {
    const { store, template } = await fixture()
    const root = await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    const child = await store.newSurface({ attemptId: 'a', key: 'child', templatePath: template, surface: 'ws-child', parent: 'ws-root' })
    await store.bindSession({ surface: root.surface, sessionId: 'agent-root', role: 'root', rootSurface: root.surface })
    await store.bindSession({
      surface: child.surface,
      sessionId: 'agent-child',
      role: 'delegated',
      rootSurface: root.surface,
      parentSessionId: 'agent-root',
    })
    await store.completeSessionBinding(child.surface, 'agent-child', child.revision)

    expect(await store.readSessionBinding({ sessionId: 'agent-child' })).toMatchObject({
      surface: 'ws-child',
      outputRevision: child.revision,
    })
    expect((await store.readWorkSession(root.surface)).events.map(event => event.type)).toEqual([
      'surface/created',
      'child/created',
      'agent/session-bound',
      'child/session-started',
      'child/session-completed',
    ])
  })

  test('rejects reuse of a Work Session event identity for another fact', async () => {
    const { store, template } = await fixture()
    await store.newSurface({ attemptId: 'a', key: 'root', templatePath: template, surface: 'ws-root' })
    await store.sessions.append({
      surface: 'ws-root',
      type: 'orchestrator/defined',
      data: { definitionRevision: `sha256:${'1'.repeat(64)}`, language: 'bash', codeHash: '1'.repeat(64) },
      idempotencyKey: 'definition:test',
    })
    await expect(store.sessions.append({
      surface: 'ws-root',
      type: 'orchestrator/defined',
      data: { definitionRevision: `sha256:${'2'.repeat(64)}`, language: 'bash', codeHash: '2'.repeat(64) },
      idempotencyKey: 'definition:test',
    })).rejects.toMatchObject({ code: 'idempotency-key-conflict' } satisfies Partial<WorkSurfaceError>)
  })

})

describe('Orchestrator definitions', () => {
  test('stores exact immutable programs in the shared canonical directory', async () => {
    const { root, store } = await fixture()
    const first = await store.defineOrchestrator('bash', 'echo hello\n')
    await expect(store.defineOrchestrator('bash', 'echo hello\n')).resolves.toEqual(first)
    await expect(store.readOrchestratorDefinition(first.revision)).resolves.toEqual(first)
    expect(await readFile(join(
      root,
      'store',
      'canonical',
      'orchestrator',
      'definitions',
      first.codeHash,
      'program',
    ), 'utf8')).toBe('echo hello\n')
  })
})
