import { isUtf8 } from 'node:buffer'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FileWorkspace, sha256, stableStringify, WorkspaceProjectionError, WorkSurfaceError, type Revision } from '@pf-worksurface/core'
import type { SurfaceSessionService } from './session-surface.ts'

/** Structural optional integration: WorkSurface neither loads nor requires b2f. */
export interface BlockToFileContext { readonly root: string; readonly scope: string; readonly agentId: string }
export interface BlockToFileChange<Result> {
  readonly path: string
  readonly expectedVersion: string
  readonly content: string | null
  readonly result: Result
}
export interface BlockToFileCommitRequest<Result> extends BlockToFileContext {
  readonly transactionId: string
  readonly changes: readonly BlockToFileChange<Result>[]
}
interface SessionLike { readonly id: string; readonly header: { readonly cwd?: string } }
interface AgentLike { readonly session: SessionLike }
interface MountedScope {
  readonly root: string
  readonly scope: string
  readonly authorization: 'mounted-workspace'
  readonly backend: WorkSurfaceBlockToFileBackend
}
type RootResolver = (agent?: AgentLike, session?: SessionLike, paths?: readonly string[]) => MountedScope | undefined
interface BlockToFileRegistration {
  readonly backendProtocolVersion?: number
  registerRootResolver(resolver: RootResolver): () => void
}
type Sessions = Pick<SurfaceSessionService, 'workRoot' | 'bindingForSession'>

/**
 * Translate file transactions only. FileWorkspace owns locking and recovery;
 * this adapter never publishes a Surface Revision/Event or advances a workflow.
 */
export class WorkSurfaceBlockToFileBackend {
  constructor(private readonly workspace: FileWorkspace) {}

  captureSnapshot(context: BlockToFileContext): Promise<Revision> {
    this.assertRoot(context)
    return this.workspace.snapshot()
  }

  head(context: BlockToFileContext): Promise<Revision> {
    this.assertRoot(context)
    return this.workspace.observe()
  }

  async readFile(context: BlockToFileContext, revision: string, path: string) {
    this.assertRoot(context)
    if (!/^sha256:[0-9a-f]{64}$/.test(revision)) throw new WorkSurfaceError('invalid-working-copy', 'b2f observation is not a WorkSurface file revision')
    const file = await this.workspace.readFile(revision as Revision, path)
    return { fileVersion: file.version, content: textContent(file.content) }
  }

  async commit<Result>(request: BlockToFileCommitRequest<Result>) {
    try {
      this.assertRoot(request)
      // Message ids are only unique within an Agent. Scope and Agent must be
      // part of the durable id, including when a restarted host replays a call.
      const operationId = `b2f:${sha256(stableStringify([request.scope, request.agentId, request.transactionId]))}`
      const outcome = await this.workspace.edit(operationId, request.changes.map(change => ({
        path: change.path, expectedVersion: change.expectedVersion,
        content: change.content === null ? null : Buffer.from(change.content, 'utf8'),
      })))
      if (outcome.status === 'conflict') {
        const expected = new Map(request.changes.map(change => [change.path, change.expectedVersion]))
        return {
          status: 'stale' as const, ok: false as const, commit: null, repoRevision: outcome.revision,
          results: [] as const, errors: [] as const,
          staleFiles: outcome.files.map(file => ({
            path: file.path, content: textContent(file.content), fileVersion: file.version,
            observedVersion: expected.get(file.path)!, repoRevision: outcome.revision, changesSinceRead: [],
          })),
        }
      }
      const results = request.changes.map(change => change.result)
      return outcome.status === 'committed'
        ? { status: 'committed' as const, ok: true as const, commit: outcome.revision,
            repoRevision: outcome.revision, results, errors: [] as const, staleFiles: [] as const }
        : { status: 'unchanged' as const, ok: true as const, commit: null,
            repoRevision: outcome.revision, results, errors: [] as const, staleFiles: [] as const }
    } catch (error) {
      const errors = [{ code: 'MATERIALIZE_FAILED' as const, path: null,
        hint: error instanceof WorkSurfaceError ? error.describe() : error instanceof Error ? error.message : String(error) }]
      if (error instanceof WorkspaceProjectionError) return {
        status: 'projection-failed' as const, ok: false as const, commit: error.revision,
        repoRevision: error.revision, results: request.changes.map(change => change.result), errors, staleFiles: [] as const,
      }
      return { status: 'failed' as const, ok: false as const, commit: null, repoRevision: null,
        results: [] as const, errors, staleFiles: [] as const }
    }
  }

  private assertRoot(context: BlockToFileContext): void {
    if (resolve(context.root) !== this.workspace.root) throw new WorkSurfaceError('unauthorized', 'b2f request does not belong to this WorkSurface authoring root')
  }
}

/** Attach when b2f is present; disposal/unmount removes only this registration. */
export function installBlockToFileAdapter(ctx: Context, workspace: FileWorkspace, sessions: Sessions): void {
  if (resolve(sessions.workRoot) !== workspace.root) throw new WorkSurfaceError('invalid-working-copy', 'WorkSurface b2f adapter and Session service have different authoring roots')
  const backend = new WorkSurfaceBlockToFileBackend(workspace)
  const scope: MountedScope = { root: workspace.root, scope: 'worksurface-authoring', authorization: 'mounted-workspace', backend }
  ctx.inject(['b2f'], mounted => {
    const b2f = mounted.get('b2f') as BlockToFileRegistration | undefined
    if (b2f === undefined) return
    const compatible = b2f.backendProtocolVersion === 1
    if (!compatible) mounted.logger.warn('WorkSurface file blocks require block-to-file backend protocol 1; writes to this authoring root are disabled until b2f is upgraded.')
    const dispose = b2f.registerRootResolver((agent, suppliedSession) => {
      const session = suppliedSession ?? agent?.session
      if (session === undefined) return undefined
      const cwd = session.header.cwd
      // A binding must not redirect a legacy private checkout into the public
      // authoring directory. Both ordinary and bound Sessions claim this mount
      // only when their actual cwd names this exact workspace.
      if (cwd === undefined || resolve(cwd) !== workspace.root) return undefined
      // Old b2f versions accept root resolvers but ignore `backend`. A refusing
      // resolver prevents their fallback Git authority from owning these files.
      if (!compatible) throw new WorkSurfaceError('effect-failed', 'WorkSurface file blocks require block-to-file backend protocol 1; upgrade b2f before retrying')
      // Once a Session selects this mounted root, b2f validates every path
      // against it. Do not delegate an escaping block to an unrelated writer.
      return scope
    })
    mounted.effect(() => dispose)
  })
}

function textContent(content: Buffer | null): string | null {
  if (content === null) return null
  if (!isUtf8(content)) throw new WorkSurfaceError('invalid-working-copy', 'b2f edits require valid UTF-8 file content')
  return content.toString('utf8')
}
