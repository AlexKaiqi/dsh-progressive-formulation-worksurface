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

/** Immutable canonical Surface head. */
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

/** Why a durable Agent Session owns a Surface. */
export type SurfaceSessionRole = 'root' | 'delegated'

/** Exact model input that caused a delegated Session to consume other Surfaces. */
export interface SurfaceSessionInput {
  readonly surfaceRevision: Revision
  readonly blockRevisions: readonly BlockRef[]
  readonly omittedBlockRevisions: readonly BlockRef[]
  readonly profile: string
}

/** Durable one-to-one identity binding between one independent Surface and one Agent Session. */
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
