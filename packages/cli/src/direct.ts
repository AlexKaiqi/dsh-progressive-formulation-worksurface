import { ProjectionCompiler, WorkSurfaceError, WorkSurfaceStore } from '@pf-worksurface/core'
import type { Revision } from '@pf-worksurface/core'
import type { WorkSurfaceRpcMethod } from './protocol.ts'

/**
 * Execute local file-only commands outside an Orchestrator sandbox.
 * @param root - WorkSurface store root.
 * @param method - File-only RPC operation to invoke.
 * @param attemptId - Effect authority and journal identity.
 * @param params - JSON-compatible operation parameters.
 * @returns The operation result.
 */
export async function executeDirect(
  root: string,
  method: WorkSurfaceRpcMethod,
  attemptId: string,
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const store = new WorkSurfaceStore({ root })
  switch (method) {
    case 'new': {
      const parent = optionalString(params, 'parent')
      const surface = optionalString(params, 'surface')
      return store.newSurface({
        attemptId,
        key: stringParam(params, 'key'),
        templatePath: stringParam(params, 'templatePath'),
        ...(parent === undefined ? {} : { parent }),
        ...(surface === undefined ? {} : { surface }),
        ...params.retry === true ? { retry: true } : {},
      })
    }
    case 'checkout':
      return store.checkout({
        surface: stringParam(params, 'surface'),
        targetPath: stringParam(params, 'targetPath'),
        ...optionalString(params, 'revision') === undefined ? {} : { revision: optionalString(params, 'revision') as Revision },
      })
    case 'commit':
      return store.commit({
        attemptId,
        key: stringParam(params, 'key'),
        workingPath: stringParam(params, 'workingPath'),
        baseRevision: stringParam(params, 'baseRevision') as Revision,
        ...params.retry === true ? { retry: true } : {},
      })
    case 'show': {
      const snapshot = await store.readSnapshot(
        stringParam(params, 'surface'),
        optionalString(params, 'revision') as Revision | undefined,
      )
      return {
        surface: snapshot.surface,
        revision: snapshot.revision,
        surfaceDocument: snapshot.surfaceDocument,
        blocks: Object.fromEntries(snapshot.blocks),
      }
    }
    case 'projection':
      return new ProjectionCompiler(store).compile({
        surface: stringParam(params, 'surface'),
        profile: stringParam(params, 'profile'),
        tokenBudget: numberParam(params, 'tokenBudget'),
        ...optionalString(params, 'revision') === undefined ? {} : { revision: optionalString(params, 'revision') as Revision },
      })
    case 'agent.run':
      throw new WorkSurfaceError('unauthorized', 'ws agent run requires a running DeepSeek Harness WorkSurface Host')
    default: {
      const unreachable: never = method
      void unreachable
      throw new Error('unknown direct WorkSurface method')
    }
  }
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string): string {
  const value = params[name]
  if (typeof value !== 'string' || value === '') throw new WorkSurfaceError('invalid-working-copy', `${name} must be a non-empty string`)
  return value
}

function optionalString(params: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = params[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') throw new WorkSurfaceError('invalid-working-copy', `${name} must be a non-empty string when present`)
  return value
}

function numberParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const value = params[name]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new WorkSurfaceError('invalid-working-copy', `${name} must be a safe integer`)
  return value
}
