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

/** Projection given to a model for one request. */
export interface WorkSurfaceProjectionSnapshot {
  readonly surfaceId: SurfaceId
  readonly surfaceRevision: Revision
  readonly blockRevisions: readonly BlockRef[]
  readonly renderedContent: string
  readonly profile: string
  readonly createdAt: string
}

/** Persisted state for one idempotent effect. */
export type EffectStatus = 'started' | 'completed' | 'failed' | 'interrupted'

/** Persisted effect-journal record. */
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
