import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

type SelectiveRootResolver = (
  agent?: Agent,
  session?: unknown,
  paths?: readonly string[],
) => string | undefined

/** Structural subset of the public b2f service used by WorkSurface. */
export interface B2FServiceContract {
  registerRootResolver?(resolver: SelectiveRootResolver): () => void
  setRootResolver(resolver: (agent?: Agent, session?: unknown) => string): void | (() => void)
  resolveRoot(agent?: Agent, session?: unknown, paths?: readonly string[]): string
}

/** Resolve the injected b2f service without coupling core packages to the runtime plugin. */
export function requireB2F(ctx: Context): B2FServiceContract {
  const service = (ctx as Context & { b2f?: B2FServiceContract }).b2f
  if (service === undefined) throw new TypeError('WorkSurface requires @deepseek-ai/dsh-block-to-file')
  return service
}

/** Install the WorkSurface root policy and return a restoration callback. */
export function installB2FRootResolver(
  ctx: Context,
  resolveRoot: (agent: Agent, paths?: readonly string[]) => string | undefined,
): () => void {
  const b2f = requireB2F(ctx)
  const selective: SelectiveRootResolver = (agent, _session, paths) =>
    agent === undefined ? undefined : resolveRoot(agent, paths)
  if (b2f.registerRootResolver !== undefined) return b2f.registerRootResolver(selective)

  // Legacy b2f exposes one replacing resolver, so preserve its previous root.
  const fallbackRoot = b2f.resolveRoot()
  const resolver = (agent?: Agent, _session?: unknown) =>
    agent === undefined ? fallbackRoot : resolveRoot(agent) ?? fallbackRoot
  const dispose = b2f.setRootResolver(resolver)
  if (dispose !== undefined) return dispose
  return () => {
    b2f.setRootResolver(() => fallbackRoot)
  }
}
