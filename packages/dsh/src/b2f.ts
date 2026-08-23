import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface B2FRootScope {
  readonly root: string
  readonly scope: string
  readonly authorization?: 'session' | 'mounted-workspace'
}

export type B2FRootResolution = string | B2FRootScope | undefined

type SelectiveRootResolver = (
  agent?: Agent,
  session?: unknown,
  paths?: readonly string[],
) => B2FRootResolution | Promise<B2FRootResolution>

export interface B2FPublicationRequest {
  readonly agent: Agent
  readonly root: string
  readonly scope: string
  readonly paths: readonly string[]
  readonly report: {
    readonly status: 'committed' | 'unchanged'
    readonly commit: string | null
    readonly repoRevision: string
  }
}

export interface B2FPublicationReceipt {
  readonly scope: string
  readonly revision: string
  readonly noOp: boolean
}

export type B2FPublisher = (
  request: B2FPublicationRequest,
) => B2FPublicationReceipt | undefined | Promise<B2FPublicationReceipt | undefined>

/** Structural subset of the public b2f service used by WorkSurface. */
export interface B2FServiceContract {
  registerRootResolver?(resolver: SelectiveRootResolver): () => void
  registerPublisher?(publisher: B2FPublisher): () => void
  setRootResolver(resolver: (agent?: Agent, session?: unknown) => string): void | (() => void)
  resolveRoot(agent?: Agent, session?: unknown, paths?: readonly string[]): string
}

/** Resolve the injected b2f service without coupling core packages to the runtime plugin. */
export function requireB2F(ctx: Context): B2FServiceContract {
  const service = (ctx as Context & { b2f?: B2FServiceContract }).b2f
  if (service === undefined) throw new TypeError('WorkSurface requires dsh-block-to-file')
  return service
}

/** Install WorkSurface root routing and canonical publication as one integration. */
export function installB2FRootResolver(
  ctx: Context,
  resolveRoot: (agent: Agent, paths?: readonly string[]) => B2FRootResolution | Promise<B2FRootResolution>,
  publish?: B2FPublisher,
): () => void {
  const b2f = requireB2F(ctx)
  const selective: SelectiveRootResolver = (agent, _session, paths) =>
    agent === undefined ? undefined : resolveRoot(agent, paths)
  let disposeRoot: () => void
  if (b2f.registerRootResolver !== undefined) {
    disposeRoot = b2f.registerRootResolver(selective)
  } else {
    // Legacy b2f exposes one replacing resolver, so preserve its broad parent
    // routing behavior until the path-aware registration API is available.
    const fallbackRoot = b2f.resolveRoot()
    const resolver = (agent?: Agent, _session?: unknown) => {
      if (agent === undefined) return fallbackRoot
      const selected = resolveRoot(agent, ['work/'])
      if (typeof selected === 'string') return selected
      if (selected !== undefined && typeof (selected as Promise<B2FRootResolution>).then !== 'function') {
        return (selected as B2FRootScope).root
      }
      return fallbackRoot
    }
    const dispose = b2f.setRootResolver(resolver)
    disposeRoot = dispose ?? (() => {
      b2f.setRootResolver(() => fallbackRoot)
    })
  }

  if (publish === undefined) return disposeRoot
  if (b2f.registerPublisher === undefined) {
    disposeRoot()
    throw new TypeError('WorkSurface requires a b2f version with canonical publication support')
  }
  const disposePublisher = b2f.registerPublisher(publish)
  return () => {
    disposePublisher()
    disposeRoot()
  }
}
