/**
 * DeepSeek Harness plugin for WorkSurface orchestration.
 * @module @pf-worksurface/dsh
 */

export { WorkSurfaceHost } from './host.ts'
export { WorkSurfaceService } from './service.ts'
export { resolveWorkSurfaceCliEntrypoint } from './config.ts'
export type { Config } from './config.ts'
export type {
  AgentCompletion,
  AgentRunResult,
  OrchestratorResult,
  PendingWorkspace,
  WorkSurfaceConfig,
  WorkSurfaceProfile,
} from './types.ts'
export { WorkSurfaceService as default } from './service.ts'
