/**
 * DeepSeek Harness plugin for WorkSurface orchestration.
 * @module @pf-worksurface/dsh
 */

export { WorkSurfaceHost } from './host.ts'
export { resolveWorkSurfaceCliEntrypoint, WorkSurfaceService } from './service.ts'
export type { Config } from './service.ts'
export type {
  AgentCompletion,
  AgentRunResult,
  OrchestratorResult,
  WorkSurfaceConfig,
  WorkSurfaceProfile,
} from './types.ts'
export { WorkSurfaceService as default } from './service.ts'
