import { afterEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ scenario: 'success' }))
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    destroy(): this { return this }
    setEncoding(): this { return this }
    write(payload: string): boolean {
      const request = JSON.parse(payload) as { id: string; token?: string }
      expect(request.token).toBeUndefined()
      queueMicrotask(() => {
        if (network.scenario === 'success') this.emit('data', `${JSON.stringify({ id: request.id, result: { ok: true } })}\n`)
        if (network.scenario === 'failure') this.emit('data', `${JSON.stringify({ id: request.id, error: { code: 'not-found', message: 'missing' } })}\n`)
      })
      return true
    }
  }
  return { createConnection: vi.fn(() => { const socket = new Socket(); queueMicrotask(() => socket.emit('connect')); return socket }) }
})

import { WorkSurfaceHostClient } from '../src/client.ts'

afterEach(() => { network.scenario = 'success' })

describe('WorkSurfaceHostClient', () => {
  it('only frames authenticated-transport service calls', async () => {
    await expect(new WorkSurfaceHostClient('/host.sock').call('event.replay', { surfaceId: 's' })).resolves.toEqual({ ok: true })
    network.scenario = 'failure'
    await expect(new WorkSurfaceHostClient('/host.sock').call('orchestrate.show', { orchestrationId: 'o' })).rejects.toMatchObject({ code: 'not-found' })
  })
})
