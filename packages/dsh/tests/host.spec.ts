import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkSurfaceHostClient } from '@pf-worksurface/cli'
import { WorkSurfaceHost } from '../src/host.ts'
import type { Socket } from 'node:net'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'worksurface-host-'))
  roots.push(value)
  return value
}

async function rawRequest(path: string, payload: string | Buffer): Promise<Record<string, unknown>> {
  const socket = createConnection(path)
  await once(socket, 'connect')
  const chunks: Buffer[] = []
  socket.on('data', chunk => chunks.push(Buffer.from(chunk)))
  socket.write(payload)
  await once(socket, 'close')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function leaveStaleSocket(path: string): Promise<void> {
  const script = `const net=require('node:net');const s=net.createServer();s.listen(${JSON.stringify(path)},()=>process.stdout.write('ready\\n'));setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  await once(child.stdout, 'data')
  child.kill('SIGKILL')
  await once(child, 'exit')
}

describe('WorkSurfaceHost', () => {
  it('round-trips one authenticated envelope and removes its private socket', async () => {
    const directory = await root()
    const path = join(directory, 'runtime', 'host.sock')
    const host = new WorkSurfaceHost(path, {
      dispatch: async request => ({ method: request.method, value: request.params.value }),
    })
    await host.start()
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    const result = await new WorkSurfaceHostClient({
      socketPath: path,
      attemptId: 'attempt-a',
      token: 'secret',
    }).call('show', { value: '中文 path with spaces' })
    expect(result).toEqual({ method: 'show', value: '中文 path with spaces' })

    await host.close()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to steal a live Host socket', async () => {
    const directory = await root()
    const path = join(directory, 'host.sock')
    const first = new WorkSurfaceHost(path, { dispatch: async () => ({}) })
    const second = new WorkSurfaceHost(path, { dispatch: async () => ({}) })
    await first.start()
    await expect(second.start()).rejects.toMatchObject({ code: 'already-exists' })
    await first.close()
  })

  it('propagates client disconnect as cancellation to the in-flight operation', async () => {
    const directory = await root()
    const path = join(directory, 'host.sock')
    const cancelled = Promise.withResolvers<boolean>()
    const host = new WorkSurfaceHost(path, {
      dispatch: async (_request, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            cancelled.resolve(true)
            resolve()
          }, { once: true })
        })
        return {}
      },
    })
    await host.start()
    const socket = createConnection(path)
    await new Promise<void>(resolve => socket.once('connect', resolve))
    socket.write(`${JSON.stringify({
      id: 'disconnect',
      method: 'show',
      attemptId: 'attempt-a',
      token: 'secret',
      params: { surface: 'ws-root' },
    })}\n`)
    socket.destroy()
    await cancelled.promise
    await host.close()
  })

  it('rejects non-sockets, replaces a stale socket, and surfaces bind failures', async () => {
    const directory = await root()
    const regularPath = join(directory, 'regular')
    await writeFile(regularPath, 'occupied')
    await expect(new WorkSurfaceHost(regularPath, { dispatch: async () => ({}) }).start())
      .rejects.toMatchObject({ code: 'unauthorized' })

    const stalePath = join(directory, 'stale.sock')
    await leaveStaleSocket(stalePath)
    expect((await stat(stalePath)).isSocket()).toBe(true)
    const replacement = new WorkSurfaceHost(stalePath, { dispatch: async () => ({ replaced: true }) })
    await replacement.start()
    await replacement.close()

    const longPath = join(directory, `${'x'.repeat(180)}.sock`)
    await expect(new WorkSurfaceHost(longPath, { dispatch: async () => ({}) }).start()).rejects.toBeDefined()
  })

  it('validates raw envelopes, reports dispatcher failures, and limits request bytes', async () => {
    const directory = await root()
    const path = join(directory, 'host.sock')
    const host = new WorkSurfaceHost(path, {
      dispatch: async (request) => {
        if (request.params.fail === true) throw new Error('dispatch failed')
        return { ok: true }
      },
    })
    await host.start()
    const invalid = [
      'not json\n',
      'null\n',
      `${JSON.stringify({})}\n`,
      `${JSON.stringify({ id: 'id', method: 1, attemptId: 'a', token: 't', params: {} })}\n`,
      `${JSON.stringify({ id: 'id', method: 'show', attemptId: '', token: 't', params: {} })}\n`,
      `${JSON.stringify({ id: 'id', method: 'show', attemptId: 'a', token: '', params: {} })}\n`,
      `${JSON.stringify({ id: 'id', method: 'show', attemptId: 'a', token: 't', params: null })}\n`,
      `${JSON.stringify({ id: 'id', method: 'show', attemptId: 'a', token: 't', params: [] })}\n`,
      `${JSON.stringify({ id: 'id', method: 'unknown', attemptId: 'a', token: 't', params: {} })}\n`,
    ]
    for (const request of invalid) {
      const response = await rawRequest(path, request)
      expect(response.error).toBeDefined()
    }
    const failure = await rawRequest(path, `${JSON.stringify({
      id: 'failure', method: 'show', attemptId: 'a', token: 't', params: { fail: true },
    })}\n`)
    expect(failure).toMatchObject({ id: 'failure', error: { code: 'effect-failed', message: 'dispatch failed' } })

    const tooLarge = await rawRequest(path, Buffer.alloc(16 * 1024 * 1024 + 1, 0x61))
    expect(tooLarge).toMatchObject({ error: { code: 'request-too-large' } })
    await host.close()
  })

  it('makes close idempotent and leaves a replacement non-socket untouched', async () => {
    const directory = await root()
    const path = join(directory, 'host.sock')
    const host = new WorkSurfaceHost(path, { dispatch: async () => ({}) })
    await host.close()
    await host.start()
    await host.close()
    await writeFile(path, 'replacement')
    await host.close()
    expect((await stat(path)).isFile()).toBe(true)
    await host.close()

    const stalePath = join(directory, 'stale-close.sock')
    await leaveStaleSocket(stalePath)
    await new WorkSurfaceHost(stalePath, { dispatch: async () => ({}) }).close()
    await expect(stat(stalePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new WorkSurfaceHost('\0', { dispatch: async () => ({}) }).close()).rejects.toBeDefined()
  })

  it('ignores extra input and suppresses writes after fake-socket departure', async () => {
    const writes: string[] = []
    const fake = new (await import('node:events')).EventEmitter() as unknown as Socket
    fake.end = ((value: string) => { writes.push(value); return fake }) as Socket['end']
    fake.destroy = () => fake
    let releaseFailure: (() => void) | undefined
    const host = new WorkSurfaceHost('/unused', {
      dispatch: async (request) => {
        if (request.id === 'failure') await new Promise<void>((resolve) => { releaseFailure = resolve })
        if (request.id === 'failure') throw new Error('late failure')
        return { ok: true }
      },
    })
    const accept = (host as unknown as { accept(socket: Socket): void }).accept.bind(host)
    accept(fake)
    fake.emit('data', '{')
    fake.emit('data', Buffer.from('"id":"ok","method":"show","attemptId":"a","token":"t","params":{}}\n'))
    fake.emit('data', Buffer.from('ignored'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writes).toHaveLength(1)
    fake.emit('error', new Error('departed'))
    fake.emit('close')

    const late = new (await import('node:events')).EventEmitter() as unknown as Socket
    late.end = ((value: string) => { writes.push(value); return late }) as Socket['end']
    late.destroy = () => late
    accept(late)
    late.emit('data', Buffer.from('{"id":"failure","method":"show","attemptId":"a","token":"t","params":{}}\n'))
    late.emit('close')
    releaseFailure?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writes).toHaveLength(1)
  })
})
