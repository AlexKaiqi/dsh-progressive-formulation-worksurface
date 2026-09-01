/** WorkSurface CLI client and local IPC protocol. */

export { WorkSurfaceHostClient } from './client.ts'
export { WORKSURFACE_RPC_METHODS } from './protocol.ts'
export { HELP, VERSION, helpFor } from './help.ts'
export type { HelpTopic } from './help.ts'
export type {
  WorkSurfaceRpcError,
  WorkSurfaceRpcMethod,
  WorkSurfaceRpcCall,
  WorkSurfaceRpcResponse,
} from './protocol.ts'
