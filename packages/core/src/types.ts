/** Stable identifiers accepted at WorkSurface filesystem and wire boundaries. */
export type SurfaceId = string & { readonly __surfaceId: unique symbol }
/** Stable identifiers accepted for Block files and references. */
export type BlockId = string & { readonly __blockId: unique symbol }
/** Content-addressed revision identifier. */
export type Revision = `sha256:${string}`

/** A revision-pinned Block result exchanged between agents. */
export interface BlockRef {
  readonly surface: SurfaceId
  readonly block: BlockId
  readonly revision: Revision
}

/** Parsed Surface document metadata. */
export interface SurfaceEnvelope {
  readonly surfaceId: SurfaceId
  readonly parent: SurfaceId | null
  readonly status: string
}

/** Parsed Block document metadata. */
export interface BlockEnvelope {
  readonly blockId: BlockId
  readonly surfaceId: SurfaceId
  readonly kind: string
  readonly status: string
  readonly derivedFrom: readonly unknown[]
}

/** Current Surface revision folded from its canonical Work Session. */
export interface SurfaceHead {
  readonly revision: Revision
  readonly commitId: string
}

/** Result of creating a Surface. */
export interface NewSurfaceResult {
  readonly surface: SurfaceId
  readonly revision: Revision
}

/** Result of materializing an immutable revision into a working copy. */
export interface CheckoutResult {
  readonly surface: SurfaceId
  readonly revision: Revision
  readonly path: string
}

/** Result of publishing a working copy. */
export interface CommitResult {
  readonly surface: SurfaceId
  readonly revision: Revision
  readonly previousRevision: Revision
  readonly noOp: boolean
}

/** Canonical contents of one Surface revision. */
export interface SurfaceSnapshot {
  readonly surface: SurfaceId
  readonly revision: Revision
  readonly surfaceDocument: string
  readonly blocks: ReadonlyMap<BlockId, string>
}

/** Immutable identity metadata for the Work Session owned by one Surface. */
export interface WorkSessionHeader {
  readonly version: 1
  readonly surfaceId: SurfaceId
  readonly parentSurfaceId: SurfaceId | null
  readonly createdAt: string
}

/** Accepted domain facts recorded by a Surface-local Work Session. */
export interface WorkSessionEventDataMap {
  readonly 'surface/created': {
    readonly parentSurfaceId: SurfaceId | null
    readonly revision: Revision
    readonly commitId: string
  }
  readonly 'child/created': {
    readonly childSurfaceId: SurfaceId
    readonly initialRevision: Revision
  }
  readonly 'surface/revision-published': {
    readonly revision: Revision
    readonly previousRevision: Revision
    readonly commitId: string
  }
  readonly 'orchestrator/defined': {
    readonly definitionRevision: Revision
    readonly language: 'bash' | 'python'
    readonly codeHash: string
  }
  readonly 'orchestrator/run-started': {
    readonly runId: string
    readonly definitionRevision: Revision
    readonly workspaceHash: string
    readonly inputRevision: Revision
  }
  readonly 'orchestrator/run-completed': {
    readonly runId: string
    readonly outputRevision: Revision
    readonly exitCode: number | null
    readonly signal: string | null
    readonly replayCount: number
  }
  readonly 'orchestrator/run-interrupted': {
    readonly runId: string
    readonly outputRevision: Revision
    readonly signal: string
    readonly replayCount: number
  }
  readonly 'orchestrator/run-failed': {
    readonly runId: string
    readonly code: string
    readonly message: string
  }
}

/**
 * Legacy Work Session event types accepted only to fail fast on pre-delegation-record
 * streams. Agent/Session attachment is no longer a domain event: it is a write-once
 * delegation record per Surface (`binding.json`), and the child boundary is owned by
 * the DSH Session tree. rc.6 streams containing these types are rejected as
 * canonical-corrupt with an actionable message.
 */
export type LegacyBoundaryEventType =
  | 'agent/session-bound'
  | 'agent/session-completed'
  | 'child/session-started'
  | 'child/session-completed'

/** Name of one accepted Work Session domain fact. */
export type WorkSessionEventType = keyof WorkSessionEventDataMap

/** One immutable, contiguous event in a Surface-local Work Session. */
export type WorkSessionEvent<T extends WorkSessionEventType = WorkSessionEventType> = {
  readonly version: 1
  readonly surface: SurfaceId
  readonly seq: number
  readonly eventId: string
  readonly type: T
  readonly data: WorkSessionEventDataMap[T]
  readonly createdAt: string
  readonly causationId?: string
  readonly correlationId?: string
  readonly attemptId?: string
  readonly idempotencyKey: string
}

/** Complete immutable replay input for one Surface's Work Session. */
export interface WorkSessionSnapshot {
  readonly header: WorkSessionHeader
  readonly events: readonly WorkSessionEvent[]
}

/** Immutable content-addressed Orchestrator definition. */
export interface OrchestratorDefinition {
  readonly revision: Revision
  readonly language: 'bash' | 'python'
  readonly codeHash: string
  readonly source: string
}

/** Why a durable Agent Session owns a Surface. */
export type SurfaceSessionRole = 'root' | 'delegated'

/** Exact model input that caused a delegated Session to consume other Surfaces. */
export interface SurfaceSessionInput {
  readonly surfaceRevision: Revision
  readonly blockRevisions: readonly BlockRef[]
  readonly omittedBlockRevisions: readonly BlockRef[]
  readonly profile: string
}

/** Durable write-once delegation record between one independent Surface and one Agent Session. */
export interface SurfaceSessionBinding {
  readonly surface: SurfaceId
  readonly sessionId: string
  readonly role: SurfaceSessionRole
  readonly rootSurface: SurfaceId
  readonly parentSessionId?: string
  readonly input?: SurfaceSessionInput
  readonly outputRevision?: Revision
  readonly createdAt: string
  readonly updatedAt: string
}

/** Request for creating an immutable Surface/Session identity binding. */
export interface BindSurfaceSessionOptions {
  readonly surface: string
  readonly sessionId: string
  readonly role: SurfaceSessionRole
  readonly rootSurface: string
  readonly parentSessionId?: string
  readonly input?: SurfaceSessionInput
}

/** Parsed Block content rendered inside one graph node. */
export interface WorkSurfaceGraphBlock {
  readonly block: BlockId
  readonly kind: string
  readonly status: string
  readonly content: string
}

/** One independent work unit in a Session-scoped WorkGraph. */
export interface WorkSurfaceGraphNode {
  readonly surface: SurfaceId
  readonly sessionId: string | null
  readonly phase: 'draft' | 'bound' | 'completed'
  readonly revision: Revision
  readonly parent: SurfaceId | null
  readonly status: string
  readonly surfaceDocument: string
  readonly blocks: readonly WorkSurfaceGraphBlock[]
}

/** Revision-pinned information flow between two Surface nodes. */
export interface WorkSurfaceDependencyEdge {
  readonly id: string
  readonly kind: 'information'
  readonly source: SurfaceId
  readonly target: SurfaceId
  readonly sourceBlock: BlockId
  readonly sourceRevision: Revision
  readonly targetRevision: Revision
  readonly omitted: boolean
}

/** Read-only graph projection owned by one top-level Session Surface. */
export interface WorkSurfaceGraphSnapshot {
  readonly rootSurface: SurfaceId
  readonly rootSessionId: string | null
  readonly createdAt: string
  readonly nodes: readonly WorkSurfaceGraphNode[]
  readonly edges: readonly WorkSurfaceDependencyEdge[]
}

/** File kind carried by a model-facing WorkSurface Projection. */
export type WorkSurfaceProjectionFileKind = 'surface' | 'block'

/** One complete revision-pinned file included in a Projection. */
export interface WorkSurfaceProjectionFile {
  readonly kind: WorkSurfaceProjectionFileKind
  readonly surfaceId: SurfaceId
  readonly blockId?: BlockId
  readonly revision: Revision
  readonly relativePath: string
  readonly content: string
  readonly writable: boolean
}

/** One revision-pinned file omitted as a whole from a Projection. */
export interface OmittedWorkSurfaceProjectionFile {
  readonly kind: 'block'
  readonly surfaceId: SurfaceId
  readonly blockId: BlockId
  readonly revision: Revision
  readonly relativePath: string
  readonly writable: boolean
  readonly reason: 'token-budget'
}

/** Projection given to a model for one request. */
export interface WorkSurfaceProjectionSnapshot {
  readonly surfaceId: SurfaceId
  readonly surfaceRevision: Revision
  readonly blockRevisions: readonly BlockRef[]
  readonly files: readonly WorkSurfaceProjectionFile[]
  readonly omittedFiles: readonly OmittedWorkSurfaceProjectionFile[]
  readonly budgetExceeded: boolean
  readonly profile: string
  readonly createdAt: string
}

/** Persisted state for one idempotent effect. */
export type EffectStatus = 'started' | 'completed' | 'failed' | 'interrupted'

/** Persisted state for one idempotent effect. */
export interface EffectRecord {
  readonly attemptId: string
  readonly key: string
  readonly type: string
  readonly requestHash: string
  readonly status: EffectStatus
  readonly result?: unknown
  readonly error?: {
    readonly code: string
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/** Named points used by deterministic fault-injection tests. */
export type FaultPoint = 'new-head-published' | 'commit-head-published' | 'journal-completed'

/** Optional evaluator hook; production callers omit it. */
export type FaultInjector = (point: FaultPoint) => void | Promise<void>
