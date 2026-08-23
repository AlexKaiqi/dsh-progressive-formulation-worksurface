/** Host methods exposed to the sandboxed `ws` CLI. */
export type WorkSurfaceRpcMethod =
  | 'agent.run'
  | 'checkout'
  | 'commit'
  | 'projection'
  | 'show'

/** One authenticated request on the local newline-delimited JSON transport. */
export interface WorkSurfaceRpcRequest {
  readonly id: string
  readonly method: WorkSurfaceRpcMethod
  readonly attemptId: string
  readonly token: string
  readonly params: Readonly<Record<string, unknown>>
}

/** Stable failure sent by the Host. */
export interface WorkSurfaceRpcError {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** One terminal response; exactly one of result and error is present. */
export interface WorkSurfaceRpcResponse {
  readonly id: string
  readonly result?: unknown
  readonly error?: WorkSurfaceRpcError
}
