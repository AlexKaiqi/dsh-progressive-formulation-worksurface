/**
 * DeepSeek Harness plugin for WorkSurface orchestration.
 * @module @pf-worksurface/dsh
 */

export { WorkSurfaceHost } from './host.ts'
export { WorkSurfaceService } from './service.ts'
export type { OrchestrationSummary, SurfaceChoice, SurfaceTopologyNode, TopologyInspection, WorkSurfaceGcResult } from './service.ts'
export { WorkSurfaceEngine } from './engine.ts'
export { DshWorkSurfaceSessionAdapter, installDshSessionAdapter } from './session-adapter.ts'
export { ContextProviderRegistry, WorkSurfaceContextRuntime } from './context/runtime.ts'
export type { ContextRuntimeHost } from './context/runtime.ts'
export { buildContextPlan, foldInjectionState, foldLastRender, foldWorkSurfaceContext, selectActiveInjections } from './context/projections.ts'
export type * from './context/types.ts'
export { SurfaceSessionAdmission } from './session-admission.ts'
export type { SurfaceSessionAdmissionRequest, SurfaceSessionAdmissionResult } from './session-admission.ts'
export { SurfaceSessionService } from './session-surface.ts'
export type { BoundSurfaceSession, SurfaceInputSource, SurfacePlanningSource, SurfaceSessionBinding, SurfaceSessionContext, SurfaceSessionGcResult } from './session-surface.ts'
export { SubprocessCodeHandlerRunner } from './code-handler.ts'
export type { Config } from './config.ts'
export type {
  WorkSurfaceConfig,
} from './types.ts'
export type {
  CodeHandlerRunner,
  OrchestrationInspection,
  OrchestrationOperationInspection,
  OrchestrationRunInspection,
  SubscriptionInspection,
  WorkSurfaceEventPort,
} from './engine.ts'
export { WorkSurfaceService as default } from './service.ts'
