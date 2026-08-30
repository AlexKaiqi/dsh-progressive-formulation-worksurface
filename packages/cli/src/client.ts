import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { WorkSurfaceError, type WorkSurfaceErrorCode } from '@pf-worksurface/core'
import type { WorkSurfaceRpcCall, WorkSurfaceRpcMethod, WorkSurfaceRpcResponse } from './protocol.ts'

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

/** Thin one-call-per-connection client. The private socket authenticates the OS user. */
export class WorkSurfaceHostClient {
  constructor(private readonly socketPath: string) {}

  call(method: WorkSurfaceRpcMethod, params: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(cancelled(signal.reason))
    return new Promise((resolve, reject) => {
      const call: WorkSurfaceRpcCall = { id: randomUUID(), method, params }
      const socket = createConnection(this.socketPath)
      let buffer = ''
      let done = false
      const settle = (fn: () => void): void => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', onAbort)
        socket.destroy()
        fn()
      }
      const onAbort = (): void => settle(() => reject(cancelled(signal?.reason)))
      signal?.addEventListener('abort', onAbort, { once: true })
      socket.setEncoding('utf8')
      socket.once('connect', () => socket.write(`${JSON.stringify(call)}\n`))
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) return settle(() => reject(new WorkSurfaceError('effect-failed', 'Host response exceeds 16 MiB')))
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        let response: WorkSurfaceRpcResponse
        try { response = JSON.parse(buffer.slice(0, newline)) as WorkSurfaceRpcResponse }
        catch { return settle(() => reject(new WorkSurfaceError('effect-failed', 'Host returned invalid JSON'))) }
        if (response.id !== call.id) return settle(() => reject(new WorkSurfaceError('effect-failed', 'Host response id mismatch')))
        const failure = response.error
        if (failure !== undefined) return settle(() => reject(new WorkSurfaceError(failure.code as WorkSurfaceErrorCode, failure.message, failure.details)))
        settle(() => resolve(response.result))
      })
      socket.once('error', error => settle(() => reject(new WorkSurfaceError('effect-failed', `cannot reach WorkSurface Host: ${error.message}`))))
      socket.once('end', () => settle(() => reject(new WorkSurfaceError('effect-failed', 'Host closed without a response'))))
    })
  }
}

function cancelled(reason: unknown): Error {
  return reason instanceof Error ? reason : new WorkSurfaceError('cancelled', typeof reason === 'string' ? reason : 'operation cancelled')
}
