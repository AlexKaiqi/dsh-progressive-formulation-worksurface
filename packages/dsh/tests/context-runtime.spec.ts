import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import { RevisionStore, SURFACE_TEMPLATE } from '@pf-worksurface/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextPlan, foldInjectionState, foldWorkSurfaceContext } from '../src/context/projections.ts'
import { WorkSurfaceContextRuntime } from '../src/context/runtime.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('fact-backed WorkSurface context runtime', () => {
  it('records an immutable Revision manifest and rebuilds the same context plan', async () => {
    const { runtime, agent, revision } = await fixture('revision')
    const first = await runtime.publishRevision(agent, 'surface-a', revision, null)
    const replay = await runtime.publishRevision(agent, 'surface-a', revision, null)

    expect(replay).toEqual(first)
    expect(agent.session.events.filter(event => event.type === 'worksurface/context-revision')).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({ ignorable: true })
    expect(foldWorkSurfaceContext(agent.session.events)).toMatchObject({ surfaceId: 'surface-a', revision })
    const plan = buildContextPlan(agent)
    expect(buildContextPlan(agent)).toEqual(plan)
    expect(plan.items.map(item => item.itemId)).toEqual([
      expect.stringContaining('surface-file:notes/decision.md:'),
      expect.stringContaining('surface-file:surface.md:'),
    ])

    const rendered = await runtime.render(agent, { contextWindow: 4096 })
    expect(rendered.contexts.map(item => item.text)).toEqual(['Choose the remote topology.\n', expect.stringContaining('Ship the fused design.')])
  })

  it('settles concurrent providers in deterministic order and replays without calling them again', async () => {
    const { runtime, agent } = await fixture('providers')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    runtime.providers.register({
      providerId: 'a-first', phases: ['analysis'], order: 1, required: false, timeoutMs: 1_000,
      provide: async () => { calls += 1; await gate; return contribution('first') },
    })
    runtime.providers.register({
      providerId: 'b-second', phases: ['analysis'], order: 2, required: false, timeoutMs: 1_000,
      provide: async () => { calls += 1; release(); return contribution('second') },
    })

    const target = { kind: 'analysis' as const, phaseOccurrenceId: 'analysis:fixture' }
    const firstId = await runtime.createOccurrence(agent, target, { kind: 'request' })
    expect(await runtime.createOccurrence(agent, target, { kind: 'request' })).toBe(firstId)
    expect(calls).toBe(2)
    expect(foldInjectionState(agent.session.events).occurrences[0]?.sections.map(item => item.providerId)).toEqual(['a-first', 'b-second'])

    const rendered = await runtime.render(agent, { contextWindow: 4096 })
    runtime.recordRender(agent, rendered)
    expect(foldInjectionState(agent.session.events).occurrences[0]).toMatchObject({ status: 'ended' })
    expect(JSON.stringify(agent.session.events.find(event => event.type === 'context/rendered'))).not.toContain('"first"')
  })

  it('fails required providers consistently and detects a corrupted provider blob', async () => {
    const failed = await fixture('required')
    let calls = 0
    failed.runtime.providers.register({
      providerId: 'required-state', phases: ['recovery'], order: 1, required: true, timeoutMs: 1_000,
      provide: async () => { calls += 1; return { kind: 'failed', errorCode: 'unavailable', retryable: true } },
    })
    const target = { kind: 'recovery' as const, phaseOccurrenceId: 'recover:1' }
    await expect(failed.runtime.createOccurrence(failed.agent, target, { kind: 'request' })).rejects.toThrow(/required-state: unavailable/)
    await expect(failed.runtime.createOccurrence(failed.agent, target, { kind: 'request' })).rejects.toThrow(/required-state: unavailable/)
    expect(calls).toBe(1)

    const corrupt = await fixture('corrupt')
    corrupt.runtime.providers.register({
      providerId: 'blob', phases: ['analysis'], order: 1, required: false, timeoutMs: 1_000,
      provide: async () => contribution('canonical bytes'),
    })
    await corrupt.runtime.createOccurrence(corrupt.agent, { kind: 'analysis' }, { kind: 'session' })
    const ref = foldInjectionState(corrupt.agent.session.events).occurrences[0]?.sections[0]?.contentRef
    if (ref?.kind !== 'blob') throw new Error('expected blob reference')
    const path = join(corrupt.root, 'runtime', 'context', 'blobs', `${ref.contentHash.slice(7)}.txt`)
    expect(await readFile(path, 'utf8')).toBe('canonical bytes')
    await writeFile(path, 'tampered', 'utf8')
    await expect(corrupt.runtime.resolve(ref)).rejects.toThrow(/does not match/)
  })

  it('rejects a required context set that exceeds the model budget', async () => {
    const { runtime, agent, revision } = await fixture('budget')
    await runtime.publishRevision(agent, 'surface-a', revision, null)
    await expect(runtime.render(agent, { contextWindow: 2 })).rejects.toThrow(/required context needs approximately/)
  })

  it('registers every context fact as a known Session extension event', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has('worksurface/context-revision')).toBe(true)
    expect(KNOWN_SESSION_EVENT_TYPES.has('context/rendered')).toBe(true)
    expect(KNOWN_SESSION_EVENT_TYPES.has('compaction/prune')).toBe(true)
  })
})

function contribution(content: string) {
  return { kind: 'contribution' as const, sections: [{ sectionId: 'section', content, sourceVersion: '1', priority: 'high' as const }] }
}

async function fixture(id: string): Promise<{ runtime: WorkSurfaceContextRuntime; agent: Agent; revision: `sha256:${string}`; root: string }> {
  const root = await mkdtemp(join(process.cwd(), `.context-${id}-`))
  roots.push(root)
  const surface = join(root, 'surface')
  await mkdir(join(surface, 'notes'), { recursive: true })
  await writeFile(join(surface, 'surface.md'), SURFACE_TEMPLATE.replace('# Goal', '# Goal\n\nShip the fused design.'), 'utf8')
  await writeFile(join(surface, 'notes', 'decision.md'), 'Choose the remote topology.\n', 'utf8')
  const revisions = new RevisionStore(join(root, 'revisions'))
  const revision = (await revisions.snapshotSurface(surface)).revision
  const ctx = new Context()
  const runtime = new WorkSurfaceContextRuntime(ctx, { revisions, runtimeRoot: join(root, 'runtime'), tokenBudget: () => 10_000 })
  const session = Session.create(SessionId(`session-${id}`))
  const agent = { id: session.id, session, options: {}, inbox: {}, status: 'idle', ctx } as unknown as Agent
  return { runtime, agent, revision, root }
}
