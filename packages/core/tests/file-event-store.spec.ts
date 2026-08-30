import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileEventStore, registrationSubject, surfaceSubject } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function store(): Promise<FileEventStore> {
  const root = await mkdtemp(join(tmpdir(), 'ws-events-')); roots.push(root)
  return new FileEventStore(join(root, 'events'))
}

describe('FileEventStore', () => {
  it('serializes same-id appends and rejects conflicting canonical content', async () => {
    const events = await store()
    const subject = surfaceSubject('alpha')
    const draft = { id: 'evt-a', name: 'note.added', payload: { value: 1 } } as const
    const [left, right] = await Promise.all([events.append(subject, draft), events.append(subject, draft)])
    expect(left).toEqual(right)
    expect(await events.replay(subject)).toHaveLength(1)
    await expect(events.append(subject, { ...draft, payload: { value: 2 } })).rejects.toMatchObject({ code: 'already-exists-conflict' })
  })

  it('allocates seq independently per subject and retains explicit causes', async () => {
    const events = await store()
    const source = await events.append(surfaceSubject('source'), { id: 'source-event', name: 'ready', payload: null })
    const target = await events.append(surfaceSubject('target'), { id: 'target-event', name: 'advance', payload: null, causes: [source] })
    const registration = await events.append(registrationSubject('reg-a'), { id: 'registered', name: 'registration.registered', payload: null })
    expect(target.seq).toBe(0)
    expect(registration.seq).toBe(0)
    expect((await events.replay(surfaceSubject('target')))[0]?.causes).toEqual([source])
  })

  it('computes guarded appends from the latest stream under the cross-instance lock', async () => {
    const left = await store()
    const right = new FileEventStore(left.root)
    const subject = surfaceSubject('atomic')
    await Promise.all([
      left.appendWith(subject, stream => ({ id: `event-${stream.length}`, name: 'observed', payload: { length: stream.length } })),
      right.appendWith(subject, stream => ({ id: `event-${stream.length}`, name: 'observed', payload: { length: stream.length } })),
    ])
    expect((await left.replay(subject)).map(event => event.payload)).toEqual([{ length: 0 }, { length: 1 }])
  })

  it('writes canonical newline-terminated JSONL', async () => {
    const events = await store()
    await events.append(surfaceSubject('alpha'), { id: 'evt-a', name: 'note', payload: null })
    const text = await readFile(join(events.root, 'surfaces', 'alpha.jsonl'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text.trim())).toMatchObject({ version: 1, subject: { kind: 'surface', id: 'alpha' }, seq: 0 })
  })
})
// Invariant assertion: [WS-05]
