import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EventContractStore,
  RevisionStore,
  RuntimeAuthorityStore,
  RuntimeEventStore,
  type Revision,
} from '@pf-worksurface/core'
import { DshCodeFirstSurfacePort } from '../src/code-first-surface-port.ts'

// Invariant assertions: [WS-25] [WS-26]

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('code-first Surface fact projection', () => {
  it('derives head from immutable Runtime Events and recovers an interrupted authoring swap idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-target-head-')); roots.push(root)
    const workRoot = join(root, 'work')
    const surface = join(workRoot, 'surfaces', 'case-a')
    await mkdir(surface, { recursive: true })
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('base'))

    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const adoptRuntimeRevision = vi.fn(async () => undefined)
    const sessions = { bindingForSurface: () => undefined, adoptRuntimeRevision } as never
    const context = { agents: { get: () => undefined } } as never
    const port = new DshCodeFirstSurfacePort(context, workRoot, join(root, 'target'), revisions, events, contracts, sessions)

    const base = await port.head('case-a')
    expect((await events.replay('case-a')).map(event => event.type.name)).toEqual(['surface.revision.admitted'])

    const candidateRoot = join(root, 'candidate')
    await mkdir(candidateRoot)
    await writeFile(join(candidateRoot, 'surface.md'), surfaceMarkdown('candidate'))
    const candidate = (await revisions.snapshotSurface(candidateRoot)).revision

    // Simulate a crash after replacing authoring but before recording the applied fact.
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('candidate'))
    await port.apply('case-a', base, candidate, { registrationId: 'flow', runId: 'run-1', causes: [] })
    expect(await port.head('case-a')).toBe(candidate)
    expect(await readFile(join(surface, 'surface.md'), 'utf8')).toBe(surfaceMarkdown('candidate'))
    expect((await events.replay('case-a')).map(event => event.type.name)).toEqual([
      'surface.revision.admitted',
      'surface.revision.applied',
    ])

    const restarted = new DshCodeFirstSurfacePort(context, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    await restarted.apply('case-a', base, candidate, { registrationId: 'flow', runId: 'run-1', causes: [] })
    expect(await restarted.head('case-a')).toBe(candidate)
    expect((await events.replay('case-a'))).toHaveLength(2)
    expect(adoptRuntimeRevision).toHaveBeenCalledWith('case-a', candidate)
  })

  it('projects an authorized Session publication as the latest head fact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-target-publish-')); roots.push(root)
    const workRoot = join(root, 'work')
    const surface = join(workRoot, 'surfaces', 'case-a')
    await mkdir(surface, { recursive: true })
    await writeFile(join(surface, 'surface.md'), surfaceMarkdown('base'))
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const sessions = { bindingForSurface: () => undefined, adoptRuntimeRevision: async () => undefined } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => undefined } } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    const base = await port.head('case-a')

    const publishedRoot = join(root, 'published')
    await mkdir(publishedRoot)
    await writeFile(join(publishedRoot, 'surface.md'), surfaceMarkdown('published'))
    const published = (await revisions.snapshotSurface(publishedRoot)).revision
    await port.recordPublished('case-a', { sessionId: 'session-a', turn: 3, expectedRevision: base, revision: published, summary: 'done' })

    expect(await port.head('case-a')).toBe(published)
    const event = (await events.replay('case-a')).at(-1)!
    expect(event.type.name).toBe('surface.revision.published')
    expect(event.payload).toMatchObject({ revision: published, expectedRevision: base, summary: 'done' })
  })

  it('adapts DSH tool completion by reference and reconstructs only completion metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-dsh-adapter-')); roots.push(root)
    const workRoot = join(root, 'work')
    const revisions = new RevisionStore(join(root, 'revisions')); await revisions.init()
    const authority = await new RuntimeAuthorityStore(join(root, 'target')).init()
    const events = new RuntimeEventStore(join(root, 'target', 'events'), authority.id)
    const contracts = new EventContractStore(join(root, 'target', 'contracts'))
    const session = {
      id: 'session-a',
      events: [
        { seq: 0, type: 'tool/call', data: { turn: 2, step: 1, callId: 'call-1', name: 'read_file', arguments: '{"path":"secret"}' } },
        {
          seq: 1,
          type: 'tool/result',
          data: {
            turn: 2,
            step: 1,
            message: {
              content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'private body' }] }],
            },
          },
        },
      ],
    }
    const sessions = {
      bindingForSession: () => ({ surfaceId: 'case-a', sessionId: 'session-a' }),
      bindingForSurface: () => undefined,
      adoptRuntimeRevision: async () => undefined,
    } as never
    const port = new DshCodeFirstSurfacePort({ agents: { get: () => ({ session }) } } as never, workRoot, join(root, 'target'), revisions, events, contracts, sessions)
    const adapted = port.adaptDshToolCompletion(session as never, session.events[1] as never)!
    const resolved = await port.resolveDshInput(adapted.ref)

    expect(adapted.surfaceId).toBe('case-a')
    expect(resolved).toEqual({
      surfaceId: 'case-a',
      name: 'dsh.tool.completed',
      payload: { turn: 2, step: 1, callId: 'call-1', toolName: 'read_file', status: 'succeeded' },
    })
    expect(JSON.stringify(resolved)).not.toContain('private body')
    expect(JSON.stringify(resolved)).not.toContain('secret')
  })
})

function surfaceMarkdown(value: string): string {
  return `# Goal\n${value}\n\n# Acceptance Criteria\nDone.\n\n# Known Facts and Constraints\nNone.\n\n# Assumptions\nNone.\n\n# Open Questions\nNone.\n\n# Current Decisions\nNone.\n\n# Deliverables and Evidence\nNone.\n`
}
