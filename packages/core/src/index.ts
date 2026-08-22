/**
 * Canonical file WorkSurface domain, immutable store, Projection compiler, and effect journal.
 * This package imports no DeepSeek Harness agent-loop implementation.
 * @module @pf-worksurface/core
 */

export { WorkSurfaceError, asWorkSurfaceError } from './error.ts'
export type { WorkSurfaceErrorCode } from './error.ts'
export { sha256, stableStringify, hashSurfaceContent } from './hash.ts'
export { SurfaceId, BlockId, deriveSurfaceId, sessionSurfaceId } from './ids.ts'
export {
  parseFrontMatter,
  parseSurfaceDocument,
  parseBlockDocument,
  parseBlockReferences,
  instantiateSurfaceDocument,
  instantiateBlockDocument,
} from './markdown.ts'
export { EffectJournal } from './journal.ts'
export { WorkSurfaceStore } from './store.ts'
export { WorkSessionLog } from './work-session.ts'
export { ProjectionCompiler, createBlockRef } from './projection.ts'
export type {
  BlockEnvelope,
  BindSurfaceSessionOptions,
  BlockId as BlockIdType,
  BlockRef,
  CheckoutResult,
  CommitResult,
  EffectRecord,
  EffectStatus,
  FaultInjector,
  FaultPoint,
  NewSurfaceResult,
  OmittedWorkSurfaceProjectionFile,
  OrchestratorDefinition,
  WorkSurfaceProjectionFile,
  WorkSurfaceProjectionFileKind,
  WorkSurfaceProjectionSnapshot,
  Revision,
  SurfaceEnvelope,
  SurfaceHead,
  SurfaceId as SurfaceIdType,
  SurfaceSnapshot,
  SurfaceSessionBinding,
  SurfaceSessionInput,
  SurfaceSessionRole,
  WorkSurfaceDependencyEdge,
  WorkSurfaceGraphBlock,
  WorkSurfaceGraphNode,
  WorkSurfaceGraphSnapshot,
  WorkSessionEvent,
  WorkSessionEventDataMap,
  WorkSessionEventType,
  WorkSessionHeader,
  WorkSessionSnapshot,
} from './types.ts'
