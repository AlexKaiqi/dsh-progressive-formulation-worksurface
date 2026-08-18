import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Structural subset of the public b2f service used by WorkSurface. */
export interface B2FServiceContract {
  setRootResolver(resolver: (agent?: Agent, session?: unknown) => string): void
  resolveRoot(agent?: Agent, session?: unknown): string
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
  resolveRoot: (agent: Agent) => string | undefined,
): () => void {
  const b2f = requireB2F(ctx)
  const fallbackRoot = b2f.resolveRoot()
  b2f.setRootResolver((agent) => agent === undefined ? fallbackRoot : resolveRoot(agent) ?? fallbackRoot)
  return () => b2f.setRootResolver(() => fallbackRoot)
}
