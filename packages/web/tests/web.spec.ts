import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, test } from 'vitest'
// The Web companion intentionally ships browser-native JavaScript.
// @ts-expect-error no declaration file is needed for its internal test surface
import { compactSummary, graphPayloadKey, layoutGraph, markdownBody, setGraphVisibility } from '../app.js'
// @ts-expect-error no declaration file is needed for its internal test surface
import { projectSessionConversation } from '../index.js'

describe('WorkSurface Web graph', () => {
  test('places a multi-input target after both producers', () => {
    const positions = layoutGraph(
      [{ surface: 'root' }, { surface: 'research' }, { surface: 'synthesis' }],
      [{ source: 'root', target: 'synthesis' }, { source: 'research', target: 'synthesis' }],
    )
    expect(positions.synthesis.x).toBeGreaterThan(positions.root.x)
    expect(positions.synthesis.x).toBeGreaterThan(positions.research.x)
  })

  test('removes runtime envelopes before rendering WorkSurface Markdown', () => {
    expect(markdownBody('---\nsurface_id: ws-root\nparent: null\nstatus: active\n---\n# Goal\n')).toBe('# Goal\n')
  })

  test('keeps graph cards compact and gives identical polling payloads one key', () => {
    expect(compactSummary('# Goal\n\nUse [[block:ws-source/evidence]] to produce a result.')).toBe('Use ws-source/evidence to produce a result.')
    const payload = { graph: { rootSurface: 'ws-root', createdAt: 'first', nodes: [], edges: [] }, conversations: {} }
    expect(graphPayloadKey(payload)).toBe(graphPayloadKey({ ...structuredClone(payload), graph: { ...payload.graph, createdAt: 'next-poll' } }))
  })

  test('hides the stale error state after a later graph refresh succeeds', () => {
    const style = { display: 'grid', removeProperty: (name: string) => { if (name === 'display') style.display = '' } }
    const empty = { hidden: false, style }
    const viewport = { hidden: true, style: { display: 'none', removeProperty: (name: string) => { if (name === 'display') viewport.style.display = '' } } }
    setGraphVisibility(empty, viewport, true)
    expect(empty).toMatchObject({ hidden: true, style: { display: 'none' } })
    expect(viewport).toMatchObject({ hidden: false, style: { display: '' } })
  })

  test('ships a Cordis-parseable patch and registers the exact web package id', async () => {
    const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
    expect(patch[0].insert[0].name).toBe('@pf-worksurface/web')
    const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
    expect(client).toContain("id: '@pf-worksurface/web'")
  })

  test('projects only a child Session live tail and filters runtime context', () => {
    const conversation = projectSessionConversation({
      header: { parentSession: 'parent' },
      firstLiveSeq: 2,
      events: [
        { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'inherited' }] } } },
        { seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }] } },
        { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'result' }] } } },
      ],
    })
    expect(conversation).toEqual([{ seq: 3, role: 'assistant', text: 'result', at: null }])
  })
})
