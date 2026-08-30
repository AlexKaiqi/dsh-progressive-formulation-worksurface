/** Methods exposed by the replaceable WorkSurface Host transport. */
export const WORKSURFACE_RPC_METHODS = [
  'surface.create',
  'event.emit', 'event.emit-turn', 'event.replay', 'event.watch',
  'orchestrate.register', 'orchestrate.pause', 'orchestrate.resume', 'orchestrate.retire', 'orchestrate.show', 'orchestrate.list',
  'topology.show', 'revision.read', 'revision.materialize',
  'legacy.report',
] as const

export type WorkSurfaceRpcMethod = typeof WORKSURFACE_RPC_METHODS[number]

/** One RPC call. Authentication is supplied by the transport, not domain fields. */
export interface WorkSurfaceRpcCall {
  readonly id: string
  readonly method: WorkSurfaceRpcMethod
  readonly params: Readonly<Record<string, unknown>>
}

export interface WorkSurfaceRpcError {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface WorkSurfaceRpcResponse {
  readonly id: string
  readonly result?: unknown
  readonly error?: WorkSurfaceRpcError
}
