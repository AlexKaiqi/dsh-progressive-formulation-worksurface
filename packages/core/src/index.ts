/**
 * Event-driven WorkSurface domain: event envelopes, Definitions, immutable
 * revisions, orchestration folds, and planned/actual projections.
 * DSH Session integration and storage-adapter implementations stay outside this package.
 * @module @pf-worksurface/core
 */

export { WorkSurfaceError, asWorkSurfaceError } from './error.ts'
export type { WorkSurfaceErrorCode } from './error.ts'
export { sha256, stableStringify } from './hash.ts'
export { DefinitionStore } from './definition-store.ts'
export { FileEventStore } from './file-event-store.ts'
export {
  RevisionStore,
  SURFACE_SECTION_TITLES,
  SURFACE_TEMPLATE,
  validateSurfaceMarkdown,
} from './revision-store.ts'
export type {
  RevisionGcOptions,
  RevisionGcResult,
  RevisionKind,
  RevisionManifest,
  RevisionManifestEntry,
  SnapshotLimits,
} from './revision-store.ts'
export {
  assertJson,
  defineOrchestration,
  emissionEventId,
  eventRef,
  expressionRoles,
  foldOrchestration,
  isSelector,
  operationIdentity,
  registrationSubject,
  requiresActivationKey,
  subjectKey,
  surfaceSubject,
  publicationEventId,
  validateEventDraft,
  validateEventRef,
  validateRegistration,
  validateWorkSurfaceEvent,
} from './event-model.ts'
export type {
  ActivationId,
  ActivationSource,
  CodeReaction,
  DeclarativeReaction,
  EmitAction,
  EmitReaction,
  FollowupAction,
  FollowupReaction,
  EventDraft,
  EventExpression,
  EventMeta,
  EventRef,
  EventSelector,
  EventSubject,
  HandlerSpec,
  JsonValue,
  ObservedEvent,
  OrchestrationActivation,
  OrchestrationDefinition,
  OrchestrationId,
  OrchestrationRecord,
  OrchestrationState,
  Registration,
  RegistrationId,
  StoredDefinition,
  SubjectKey,
  SubscriptionDefinition,
  SurfaceId,
  Revision,
  WorkSurfaceEvent,
} from './event-model.ts'
export {
  deriveActivations,
  inspectEventCondition,
  projectActualFlow,
  projectPlannedFlow,
  subscriptionFor,
} from './orchestration.ts'
export type { ActualFlowEdge, EventConditionInspection, PlannedFlowEdge } from './orchestration.ts'
export { defineWorkSurfaceView, projectSurfaceLifecycle } from './view-projection.ts'
export type {
  SurfaceDisplayPhase,
  SurfaceLifecycleProjection,
  ViewInterpretationDisplay,
  WorkSurfaceViewDefinition,
} from './view-projection.ts'
