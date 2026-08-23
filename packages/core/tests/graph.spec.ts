import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ProjectionCompiler, WorkSurfaceError, WorkSurfaceStore } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function template(root: string, name: string, surfaceBody: string, blocks: Record<string, string> = {}): Promise<string> {
  const path = join(root, name)
  await mkdir(join(path, 'blocks'), { recursive: true })
  await writeFile(join(path, 'surface.md'), surfaceBody)
  for (const [id, body] of Object.entries(blocks)) {
    await writeFile(join(path, 'blocks', `${id}.md`), `---
block_id: ${id}
surface_id: template
kind: evidence
status: accepted
derived_from: []
---
${body}
`)
  }
  return path
}

async function graphFixture(): Promise<{ root: string; store: WorkSurfaceStore }> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-graph-'))
  roots.push(root)
  return { root, store: new WorkSurfaceStore({ root: join(root, 'store') }) }
}

describe('Surface/Session binding', () => {
  test('is one-to-one, durable, and idempotent for the same identity pair', async () => {
    const { root, store } = await graphFixture()
    const source = await template(root, 'root-template', '# Root\n')
    await store.newSurface({ attemptId: 'a', key: 'root', templatePath: source, surface: 'ws-root' })
    const first = await store.bindSession({ surface: 'ws-root', sessionId: 'session-root', role: 'root', rootSurface: 'ws-root' })
    await expect(store.bindSession({ surface: 'ws-root', sessionId: 'session-root', role: 'root', rootSurface: 'ws-root' }))
      .resolves.toEqual(first)
    await expect(store.bindSession({ surface: 'ws-root', sessionId: 'session-other', role: 'root', rootSurface: 'ws-root' }))
      .rejects.toMatchObject({ code: 'session-binding-conflict' } satisfies Partial<WorkSurfaceError>)

    const reopened = new WorkSurfaceStore({ root: join(root, 'store') })
    await expect(reopened.readSessionBinding({ sessionId: 'session-root' })).resolves.toEqual(first)
  })

  test('rejects binding one Session to a second Surface', async () => {
    const { root, store } = await graphFixture()
    const source = await template(root, 'template', '# Surface\n')
    await store.newSurface({ attemptId: 'a', key: 'root', templatePath: source, surface: 'ws-root' })
    const child = await store.newSurface({ attemptId: 'a', key: 'child', templatePath: source, surface: 'ws-child', parent: 'ws-root' })
    await store.bindSession({ surface: 'ws-root', sessionId: 'session-root', role: 'root', rootSurface: 'ws-root' })
    await expect(store.bindSession({
      surface: 'ws-child', sessionId: 'session-root', role: 'delegated', rootSurface: 'ws-root', parentSessionId: 'session-root',
      execution: 'continuable',
      input: {
        surfaceRevision: child.revision, blockRevisions: [], omittedBlockRevisions: [], profile: 'test', task: 'child work',
      },
    })).rejects.toMatchObject({ code: 'session-binding-conflict' } satisfies Partial<WorkSurfaceError>)
  })
})

describe('WorkGraph projection', () => {
  test('derives the tree from delegation records and pins multi-parent input revisions', async () => {
    const { root, store } = await graphFixture()
    const rootTemplate = await template(root, 'root-template', '# Root\n', { root_fact: 'root fact' })
    const sourceTemplate = await template(root, 'source-template', '# Source\n', { source_fact: 'source fact' })
    const targetTemplate = await template(
      root,
      'target-template',
      '# Target\n\n[[block:ws-root/root_fact]]\n[[block:ws-source/source_fact]]\n',
      { target_result: 'target result' },
    )
    await store.newSurface({ attemptId: 'a', key: 'root', templatePath: rootTemplate, surface: 'ws-root' })
    const source = await store.newSurface({ attemptId: 'a', key: 'source', templatePath: sourceTemplate, surface: 'ws-source', parent: 'ws-root' })
    await store.newSurface({ attemptId: 'a', key: 'target', templatePath: targetTemplate, surface: 'ws-target', parent: 'ws-root' })
    await store.bindSession({ surface: 'ws-root', sessionId: 'session-root', role: 'root', rootSurface: 'ws-root' })
    await store.bindSession({
      surface: 'ws-source', sessionId: 'session-source', role: 'delegated', rootSurface: 'ws-root', parentSessionId: 'session-root',
      execution: 'continuable',
      input: {
        surfaceRevision: source.revision, blockRevisions: [], omittedBlockRevisions: [], profile: 'research', task: 'source work',
      },
    })
    const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-target', profile: 'research', tokenBudget: 10_000 })
    await store.bindSession({
      surface: 'ws-target',
      sessionId: 'session-target',
      role: 'delegated',
      rootSurface: 'ws-root',
      parentSessionId: 'session-root',
      execution: 'continuable',
      input: {
        surfaceRevision: projection.surfaceRevision,
        blockRevisions: projection.blockRevisions,
        omittedBlockRevisions: [],
        profile: projection.profile,
        task: 'target work',
      },
    })
    await store.completeSessionBinding('ws-target', 'session-target', {
      surface: 'ws-target',
      surfaceRevision: projection.surfaceRevision,
      summary: 'target complete',
      outputs: [{ surface: 'ws-target', block: 'target_result', revision: projection.surfaceRevision }],
    })

    const graph = await store.graphSnapshot('ws-root')
    expect(graph.rootSessionId).toBe('session-root')
    expect(graph.nodes.map(node => [node.surface, node.sessionId, node.phase])).toEqual([
      ['ws-root', 'session-root', 'bound'],
      ['ws-source', 'session-source', 'bound'],
      ['ws-target', 'session-target', 'completed'],
    ])
    expect(graph.edges.map(edge => [edge.source, edge.target, edge.sourceBlock, edge.sourceRevision])).toEqual([
      ['ws-root', 'ws-target', 'root_fact', projection.blockRevisions[0]?.revision],
      ['ws-source', 'ws-target', 'source_fact', projection.blockRevisions[1]?.revision],
    ])

    // A Surface without a delegation record is not a graph member: a work unit
    // exists only when its Session exists.
    const orphanTemplate = await template(root, 'orphan-template', '# Orphan\n')
    await store.newSurface({ attemptId: 'a', key: 'orphan', templatePath: orphanTemplate, surface: 'ws-orphan', parent: 'ws-root' })
    expect((await store.graphSnapshot('ws-root')).nodes.map(node => node.surface)).not.toContain('ws-orphan')
  })

  test('rejects a graph root without a delegation record', async () => {
    const { root, store } = await graphFixture()
    const source = await template(root, 'root-template', '# Root\n')
    await store.newSurface({ attemptId: 'a', key: 'root', templatePath: source, surface: 'ws-root' })
    await expect(store.graphSnapshot('ws-root')).rejects.toMatchObject({ code: 'not-found' } satisfies Partial<WorkSurfaceError>)
  })
})
