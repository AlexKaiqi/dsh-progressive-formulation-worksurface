import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ mode: 'timeout' as 'timeout' | 'enoent' | 'unexpected' }))

vi.mock('node:net', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:net')>()
  return {
    ...original,
    createConnection: vi.fn(() => {
      const socket = new EventEmitter() as EventEmitter & { destroy(): void }
      socket.destroy = vi.fn()
      if (probe.mode !== 'timeout') {
        queueMicrotask(() => socket.emit('error', Object.assign(new Error(probe.mode), {
          code: probe.mode === 'enoent' ? 'ENOENT' : 'EACCES',
        })))
      }
      return socket
    }),
  }
})

import { WorkSurfaceHost } from '../src/host.ts'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function staleSocket(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worksurface-host-probe-'))
  roots.push(root)
  const path = join(root, name)
  const script = `const net=require('node:net');const s=net.createServer();s.listen(${JSON.stringify(path)},()=>process.stdout.write('ready\\n'));setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  await once(child.stdout, 'data')
  child.kill('SIGKILL')
  await once(child, 'exit')
  return path
}

describe('existing Host socket probe', () => {
  it('times out a probe that never settles', async () => {
    const path = await staleSocket('timeout.sock')
    probe.mode = 'timeout'
    await expect(new WorkSurfaceHost(path, { dispatch: async () => ({}) }).start())
      .rejects.toMatchObject({ code: 'effect-failed' })
  })

  it('replaces a socket that disappears during the probe', async () => {
    const path = await staleSocket('missing.sock')
    probe.mode = 'enoent'
    const host = new WorkSurfaceHost(path, { dispatch: async () => ({}) })
    await host.start()
    await host.close()
  })

  it('propagates an unexpected probe error', async () => {
    const path = await staleSocket('error.sock')
    probe.mode = 'unexpected'
    await expect(new WorkSurfaceHost(path, { dispatch: async () => ({}) }).start())
      .rejects.toMatchObject({ code: 'EACCES' })
  })
})
