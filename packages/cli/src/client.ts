import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { WorkSurfaceError } from '@pf-worksurface/core'
import type { WorkSurfaceErrorCode } from '@pf-worksurface/core'
import type { WorkSurfaceRpcMethod, WorkSurfaceRpcRequest, WorkSurfaceRpcResponse } from './protocol.ts'

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

interface ClientOptions {
  readonly socketPath: string
  readonly attemptId: string
  readonly token: string
}

/** One-request-per-connection local IPC client used inside an Orchestrator sandbox. */
export class WorkSurfaceHostClient {
  constructor(private readonly options: ClientOptions) {}

  /**
   * Execute one Host operation and await its validated terminal frame.
   * @param method - RPC operation to invoke.
   * @param params - JSON-compatible operation parameters.
   * @param signal - Optional caller cancellation signal.
   * @returns The Host operation result.
  */
  call(method: WorkSurfaceRpcMethod, params: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(cancellationError(signal.reason))
    return new Promise((resolve, reject) => {
      const request: WorkSurfaceRpcRequest = {
        id: randomUUID(),
        method,
        attemptId: this.options.attemptId,
        token: this.options.token,
        params,
      }
      const socket = createConnection(this.options.socketPath)
      let buffer = ''
      let settled = false
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        socket.destroy()
        action()
      }
      const abort = (): void => {
        finish(() => {
          reject(cancellationError(signal?.reason))
        })
      }
      signal?.addEventListener('abort', abort, { once: true })
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        socket.write(`${JSON.stringify(request)}\n`)
      })
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
          finish(() => {
            reject(new WorkSurfaceError('effect-failed', 'WorkSurface Host response exceeded 16 MiB'))
          })
          return
        }
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        let response: WorkSurfaceRpcResponse
        try {
          response = JSON.parse(buffer.slice(0, newline)) as WorkSurfaceRpcResponse
        } catch {
          finish(() => {
            reject(new WorkSurfaceError('effect-failed', 'WorkSurface Host returned invalid JSON'))
          })
          return
        }
        if (response.id !== request.id) {
          finish(() => {
            reject(new WorkSurfaceError('effect-failed', 'WorkSurface Host response id did not match request'))
          })
        } else if (response.error !== undefined) {
          const responseError = response.error
          finish(() => {
            reject(new WorkSurfaceError(
              responseError.code as WorkSurfaceErrorCode,
              responseError.message,
              responseError.details,
            ))
          })
        } else {
          finish(() => {
            resolve(response.result)
          })
        }
      })
      socket.once('error', (error) => {
        finish(() => {
          reject(new WorkSurfaceError('effect-failed', `cannot reach WorkSurface Host: ${error.message}`))
        })
      })
      socket.once('end', () => {
        finish(() => {
          reject(new WorkSurfaceError('effect-failed', 'WorkSurface Host closed without a response'))
        })
      })
    })
  }
}

function cancellationError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new WorkSurfaceError('cancelled', typeof reason === 'string' ? reason : 'operation cancelled')
}
