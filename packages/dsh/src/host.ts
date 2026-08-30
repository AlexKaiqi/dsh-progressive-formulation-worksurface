import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { asWorkSurfaceError, WorkSurfaceError } from '@pf-worksurface/core'
import { WORKSURFACE_RPC_METHODS, type WorkSurfaceRpcCall, type WorkSurfaceRpcResponse } from '@pf-worksurface/cli'

const MAX_CALL_BYTES = 16 * 1024 * 1024

/** Authenticated RPC dispatcher owned by the WorkSurface service. */
export interface HostDispatcher {
  dispatch(call: WorkSurfaceRpcCall, signal: AbortSignal): Promise<unknown>
}

/** Private one-request-per-connection NDJSON Host. */
export class WorkSurfaceHost {
  private readonly sockets = new Set<Socket>()
  private server: Server | undefined

  constructor(readonly socketPath: string, private readonly dispatcher: HostDispatcher) {}

  /** Bind the private Unix socket, refusing to unlink anything except a stale socket. */
  async start(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.socketPath), 0o700)
    try {
      const existing = await lstat(this.socketPath)
      if (!existing.isSocket()) {
        throw new WorkSurfaceError('unauthorized', `Host path exists and is not a socket: ${this.socketPath}`)
      }
      if (await socketIsLive(this.socketPath)) {
        throw new WorkSurfaceError('already-exists', `a live WorkSurface Host already owns ${this.socketPath}`)
      }
      await rm(this.socketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const server = createServer((socket) => {
      this.accept(socket)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.socketPath)
    })
    await chmod(this.socketPath, 0o600)
  }

  /** Stop admission, abort live requests, drain sockets, and remove the socket. */
  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
    try {
      const current = await lstat(this.socketPath)
      if (current.isSocket()) await rm(this.socketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    const abort = new AbortController()
    let buffer = Buffer.alloc(0)
    let handled = false
    socket.on('data', (chunk) => {
      if (handled) return
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      if (buffer.byteLength > MAX_CALL_BYTES) {
        handled = true
        this.write(socket, { id: '', error: { code: 'request-too-large', message: 'Host call exceeds 16 MiB' } })
        return
      }
      const newline = buffer.indexOf(0x0a)
      if (newline < 0) return
      handled = true
      void this.handle(socket, buffer.subarray(0, newline).toString('utf8'), abort.signal)
    })
    const departed = () => {
      this.sockets.delete(socket)
      if (!abort.signal.aborted) abort.abort(new WorkSurfaceError('cancelled', 'Host client disconnected'))
    }
    socket.once('close', departed)
    socket.once('error', departed)
  }

  private async handle(socket: Socket, line: string, signal: AbortSignal): Promise<void> {
    let id = ''
    try {
      const call = parseCall(line)
      id = call.id
      if (!(WORKSURFACE_RPC_METHODS as readonly string[]).includes(call.method)) {
        throw new WorkSurfaceError('invalid-working-copy', `Unknown Host method '${call.method}'`)
      }
      const result = await this.dispatcher.dispatch(call, signal)
      if (!signal.aborted) this.write(socket, { id, result })
    } catch (error) {
      const failure = asWorkSurfaceError(error)
      if (!signal.aborted) {
        this.write(socket, {
          id,
          error: {
            code: failure.code,
            message: failure.message,
            details: failure.details,
          },
        })
      }
    }
  }

  private write(socket: Socket, response: WorkSurfaceRpcResponse): void {
    socket.end(`${JSON.stringify(response)}\n`)
  }
}

async function socketIsLive(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection(path)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new WorkSurfaceError('effect-failed', `timed out probing existing Host socket: ${path}`))
    }, 500)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.destroy()
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
        || (error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve(false)
      } else {
        reject(error)
      }
    })
  })
}

function parseCall(line: string): WorkSurfaceRpcCall {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new WorkSurfaceError('invalid-working-copy', 'Host call is not valid JSON')
  }
  if (value === null || typeof value !== 'object') {
    throw new WorkSurfaceError('invalid-working-copy', 'Host call must be an object')
  }
  const request = value as Record<string, unknown>
  if (typeof request.id !== 'string' || request.id === ''
    || typeof request.method !== 'string'
    || request.params === null || typeof request.params !== 'object' || Array.isArray(request.params)) {
    throw new WorkSurfaceError('invalid-working-copy', 'Host call has an invalid envelope')
  }
  return {
    id: request.id,
    method: request.method as WorkSurfaceRpcCall['method'],
    params: request.params as Readonly<Record<string, unknown>>,
  }
}
