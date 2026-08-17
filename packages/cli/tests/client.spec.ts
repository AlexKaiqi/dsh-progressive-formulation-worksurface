import { afterEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ scenario: 'success' as string }))

vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeSocket extends EventEmitter {
    destroy(): this { return this }
    setEncoding(): this { return this }
    write(payload: string): boolean {
      const request = JSON.parse(payload) as { id: string }
      queueMicrotask(() => {
        switch (network.scenario) {
          case 'success':
            this.emit('data', `${JSON.stringify({ id: request.id, result: { ok: true } })}\n`)
            this.emit('end')
            break
          case 'partial':
            this.emit('data', JSON.stringify({ id: request.id, result: { ok: true } }))
            this.emit('data', '\n')
            break
          case 'host-error': this.emit('data', `${JSON.stringify({ id: request.id, error: { code: 'not-found', message: 'missing', details: { id: 1 } } })}\n`); break
          case 'invalid-json': this.emit('data', '{\n'); break
          case 'mismatch': this.emit('data', `${JSON.stringify({ id: 'other', result: null })}\n`); break
          case 'huge': this.emit('data', 'x'.repeat(16 * 1024 * 1024 + 1)); break
          case 'silent': break
          case 'error': this.emit('error', new Error('refused')); break
          case 'end': this.emit('end'); break
        }
      })
      return true
    }
  }
  return {
    createConnection: vi.fn(() => {
      const socket = new FakeSocket()
      if (network.scenario === 'error' || network.scenario === 'end') {
        queueMicrotask(() => socket.emit(network.scenario, network.scenario === 'error' ? new Error('refused') : undefined))
      } else {
        queueMicrotask(() => socket.emit('connect'))
      }
      return socket
    }),
  }
})

import { WorkSurfaceHostClient } from '../src/client.ts'

afterEach(() => {
  network.scenario = 'success'
})

function client(): WorkSurfaceHostClient {
  return new WorkSurfaceHostClient({ socketPath: '/host.sock', attemptId: 'attempt', token: 'token' })
}

describe('WorkSurfaceHostClient', () => {
  it('handles success, split frames, Host failures, invalid frames, and response limits', async () => {
    for (const [scenario, expected] of [
      ['success', { ok: true }],
      ['partial', { ok: true }],
    ] as const) {
      network.scenario = scenario
      await expect(client().call('show', {})).resolves.toEqual(expected)
    }
    network.scenario = 'host-error'
    await expect(client().call('show', {})).rejects.toMatchObject({ code: 'not-found', message: 'missing', details: { id: 1 } })
    network.scenario = 'invalid-json'
    await expect(client().call('show', {})).rejects.toThrow('returned invalid JSON')
    network.scenario = 'mismatch'
    await expect(client().call('show', {})).rejects.toThrow('response id did not match')
    network.scenario = 'huge'
    await expect(client().call('show', {})).rejects.toThrow('response exceeded 16 MiB')
  })

  it('handles cancellation before and during a request', async () => {
    const already = new AbortController()
    already.abort(new Error('already cancelled'))
    await expect(client().call('show', {}, already.signal)).rejects.toThrow('already cancelled')
    const stringReason = new AbortController()
    stringReason.abort('stop now')
    await expect(client().call('show', {}, stringReason.signal)).rejects.toMatchObject({ code: 'cancelled', message: 'stop now' })
    const emptyReason = new AbortController()
    emptyReason.abort()
    await expect(client().call('show', {}, emptyReason.signal)).rejects.toBeDefined()
    await expect(client().call('show', {}, { aborted: true, reason: undefined } as AbortSignal))
      .rejects.toMatchObject({ code: 'cancelled', message: 'operation cancelled' })

    network.scenario = 'silent'
    const active = new AbortController()
    const pending = client().call('show', {}, active.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    active.abort('active cancellation')
    await expect(pending).rejects.toMatchObject({ code: 'cancelled', message: 'active cancellation' })
  })

  it('normalizes connection errors and response-less closes and ignores late settlement', async () => {
    network.scenario = 'error'
    await expect(client().call('show', {})).rejects.toThrow('cannot reach WorkSurface Host: refused')
    network.scenario = 'end'
    await expect(client().call('show', {})).rejects.toThrow('closed without a response')

    network.scenario = 'success'
    const result = client().call('show', {})
    await expect(result).resolves.toEqual({ ok: true })
  })
})
