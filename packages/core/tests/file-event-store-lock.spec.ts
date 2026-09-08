import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileEventStore, surfaceSubject } from '../src/index.ts'

const io = vi.hoisted(() => ({
  created: undefined as (() => Promise<void>) | undefined,
  appending: undefined as (() => Promise<void>) | undefined,
  contending: undefined as (() => Promise<void>) | undefined,
  streamPath: '',
}))

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] === 'wx' && io.created !== undefined) {
        const pause = io.created; io.created = undefined
        await pause()
      }
      if (args[1] === 'a' && io.appending !== undefined) {
        const pause = io.appending; io.appending = undefined
        await pause()
      }
      return handle
    },
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const content = await fs.readFile(...args)
      const path = String(args[0])
      if (io.contending !== undefined && (path === io.streamPath || path.endsWith('.ticket'))) {
        const pause = io.contending; io.contending = undefined
        await pause()
      }
      return content
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  io.created = io.appending = io.contending = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function gate() {
  let reached!: () => void
  let release!: () => void
  const ready = new Promise<void>(resolve => { reached = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  return { ready, release, pause: async () => { reached(); await resume } }
}

describe('FileEventStore lock publication', () => {
  it('cannot steal a writer during owner publication and append from an outdated stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-event-lock-')); roots.push(root)
    const left = new FileEventStore(join(root, 'events'))
    const right = new FileEventStore(left.root)
    const subject = surfaceSubject('interleaved')
    const created = gate(); const appending = gate(); const contending = gate()
    io.streamPath = join(left.root, 'surfaces', 'interleaved.jsonl')
    io.created = created.pause
    io.appending = appending.pause
    const first = left.append(subject, { id: 'left', name: 'observed', payload: null })
    const firstSettled = Promise.allSettled([first])
    let second: ReturnType<FileEventStore['append']> | undefined
    try {
      await created.ready
      second = right.append(subject, { id: 'right', name: 'observed', payload: null })
      await appending.ready
      // The second writer owns the stream but has not written. With the old
      // empty-PID lock, the first writer now reads an empty stream without waiting.
      // With atomic owner publication, it instead observes the second's ticket.
      io.contending = contending.pause
      created.release()
      await contending.ready
      appending.release()
      await second
      contending.release()
      await first
      expect((await left.replay(subject)).map(event => ({ id: event.id, seq: event.seq })))
        .toEqual([{ id: 'right', seq: 0 }, { id: 'left', seq: 1 }])
    } finally {
      created.release(); appending.release(); contending.release()
      await Promise.allSettled([firstSettled, second])
    }
  })
})
