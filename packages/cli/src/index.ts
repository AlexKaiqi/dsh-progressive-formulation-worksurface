/** WorkSurface CLI client and local IPC protocol. */

export { WorkSurfaceHostClient } from './client.ts'
export { executeDirect } from './direct.ts'
export type {
  WorkSurfaceRpcError,
  WorkSurfaceRpcMethod,
  WorkSurfaceRpcRequest,
  WorkSurfaceRpcResponse,
} from './protocol.ts'
