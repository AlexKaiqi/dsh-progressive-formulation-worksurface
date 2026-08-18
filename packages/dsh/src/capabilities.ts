import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import type { DshEnvironmentKey } from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ProjectionCompiler,
  stableStringify,
  WorkSurfaceError,
  WorkSurfaceStore,
} from '@pf-worksurface/core'
import type { Revision, SurfaceIdType } from '@pf-worksurface/core'
import { renderFileProjection } from './model/file-projection.ts'
import { ORCHESTRATOR_OUTPUT, ORCHESTRATOR_TOOL_SURFACE } from './model/orchestrator-tool.ts'
import { WORKSURFACE_GUIDANCE_ORDER, worksurfaceGuidance } from './model/guidance.ts'
import type { AttemptAuthority, ChildCredential, OrchestratorResult, PendingWorkspace, WorkSurfaceConfig, WorkSurfaceProfile } from './types.ts'

export interface CapabilitiesHost {
  readonly ctx: Context
  readonly config: WorkSurfaceConfig
  readonly store: WorkSurfaceStore
  readonly projections: ProjectionCompiler
  readonly openSessionSurface: (agent: Agent) => Promise<{ surface: SurfaceIdType; revision: Revision }>
  readonly openSessionWorkspace: (
    agent: Agent,
    current: { surface: SurfaceIdType; revision: Revision },
  ) => Promise<PendingWorkspace>
  readonly defaultProfile: () => WorkSurfaceProfile
  readonly runOrchestrator: (
    parent: Agent,
    language: 'bash' | 'python',
    script: string,
    rootSurfaceInput: string,
    signal: AbortSignal,
  ) => Promise<OrchestratorResult>
  readonly childBinding: (agentId: string) => { attempt: AttemptAuthority; credential: ChildCredential } | undefined
  readonly parentWorkspace: (agentId: string) => PendingWorkspace | undefined
}

export function installHarnessCapabilities(host: CapabilitiesHost): void {
  const { ctx, config, store, projections } = host

  ctx.systemPrompt.section({
    name: 'worksurface:guidance',
    order: WORKSURFACE_GUIDANCE_ORDER,
    text: context => context.agent === undefined || isDelegatedAgent(context.agent) ? '' : worksurfaceGuidance(),
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const transformed = await next()
    if (context.agent === undefined || isDelegatedAgent(context.agent)) return transformed
    context.signal?.throwIfAborted()
    const current = await host.openSessionSurface(context.agent)
    await host.openSessionWorkspace(context.agent, current)
    const profile = host.defaultProfile()
    const projection = await projections.compile({
      surface: current.surface,
      profile: profile.name,
      tokenBudget: profile.tokenBudget,
      revision: current.revision,
    })
    context.signal?.throwIfAborted()
    transformed.contexts.push({
      name: 'worksurface:projection',
      text: renderFileProjection(projection, { writablePathPrefix: 'work/root' }),
    })
    return transformed
  })
  ctx.tools.register(defineTool({
    ...ORCHESTRATOR_TOOL_SURFACE,
    output: ORCHESTRATOR_OUTPUT,
    isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new WorkSurfaceError('unauthorized', 'run_orchestrator requires a calling Agent')
      const rootSurface = args.rootSurface === undefined || args.rootSurface.trim() === ''
        ? (await host.openSessionSurface(exec.agent)).surface
        : args.rootSurface
      return host.runOrchestrator(exec.agent, args.language, args.script, rootSurface, exec.signal)
    },
  }))
  ctx.tools.guard((exec) => {
    if (exec.name === 'run_orchestrator') return undefined
    return jsonContainsPath(exec.arguments, store.canonicalRoot)
      ? 'WorkSurface canonical state is Host-only; use the ws CLI'
      : undefined
  })
  const variables = {
    DSH_B2F_ROOT: { description: 'Current b2f materialization root.' },
    DSH_WS_HOST_SOCKET: { description: 'Private WorkSurface Host socket for an authorized child Agent.' },
    DSH_WS_ATTEMPT_ID: { description: 'Current WorkSurface attempt identity.' },
    DSH_WS_ATTEMPT_TOKEN: { description: 'Least-authority credential for an authorized child Agent.' },
    DSH_WS_ATTEMPT_DIR: { description: 'Current public WorkSurface attempt workspace.' },
    DSH_WS_WORKING_PATH: { description: 'Current editable WorkSurface checkout.' },
    DSH_WS_SURFACE: { description: 'Surface represented by the editable checkout.' },
    DSH_WS_BASE_REVISION: { description: 'Exact commit base for the editable checkout.' },
  } as const
  ctx.shellEnv.register({
    name: 'worksurface',
    variables,
    resolve: (exec) => {
      if (exec.agent === undefined) return {}
      const binding = host.childBinding(exec.agent.id)
      if (binding !== undefined) {
        const { attempt, credential } = binding
        return {
          DSH_B2F_ROOT: credential.workingPath,
          DSH_WS_HOST_SOCKET: config.socketPath,
          DSH_WS_ATTEMPT_ID: credential.attemptId,
          DSH_WS_ATTEMPT_TOKEN: credential.token,
          DSH_WS_ATTEMPT_DIR: attempt.workspaceRoot,
          DSH_WS_WORKING_PATH: credential.workingPath,
          DSH_WS_SURFACE: credential.surface,
          DSH_WS_BASE_REVISION: credential.baseRevision,
        } satisfies Partial<Record<DshEnvironmentKey, string>>
      }
      const workspace = host.parentWorkspace(String(exec.agent.id))
      if (workspace === undefined) return {}
      return {
        DSH_B2F_ROOT: workspace.workspaceRoot,
        DSH_WS_ATTEMPT_DIR: workspace.workspaceRoot,
        DSH_WS_WORKING_PATH: workspace.rootWorkingPath,
        DSH_WS_SURFACE: workspace.rootSurface,
        DSH_WS_BASE_REVISION: workspace.rootBaseRevision,
      } satisfies Partial<Record<DshEnvironmentKey, string>>
    },
  })
}

function isDelegatedAgent(agent: Agent): boolean {
  const header = agent.session.header
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

function jsonContainsPath(value: unknown, canonicalRoot: string): boolean {
  try {
    return stableStringify(value).includes(canonicalRoot)
  } catch {
    return false
  }
}
