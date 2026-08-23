import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-subagent'
import type { Context } from '@deepseek-ai/cordis'
import { EffectJournal, ProjectionCompiler, SurfaceId, WorkSurfaceError, WorkSurfaceStore } from '@pf-worksurface/core'
import type { SurfaceIdType, SurfaceSessionBinding } from '@pf-worksurface/core'
import { childPersona } from './model/child-agent.ts'
import { renderFileProjection } from './model/file-projection.ts'
import { readJsonOptional } from './json.ts'
import { safeKey } from './params.ts'
import type { AgentRunResult, AttemptAuthority, WorkSurfaceProfile } from './types.ts'

export interface AgentRunRequest {
  readonly surface: SurfaceIdType
  readonly task: string
  readonly profile: string
  readonly key: string
  readonly templatePath?: string
  readonly parent?: string
  readonly retry: boolean
  readonly signal: AbortSignal
}

export interface AgentRunHost {
  readonly ctx: Context
  readonly store: WorkSurfaceStore
  readonly projections: ProjectionCompiler
  readonly agentJournal: EffectJournal
  readonly profile: (name: string) => WorkSurfaceProfile
  readonly startContinuable: (
    profile: WorkSurfaceProfile,
    parent: AttemptAuthority['parent'],
    surface: string,
    task: string,
    persona: string,
    signal: AbortSignal,
  ) => Promise<string>
  readonly resumeContinuable: (
    parent: AttemptAuthority['parent'],
    binding: SurfaceSessionBinding,
    task: string,
    signal: AbortSignal,
  ) => Promise<void>
  readonly bindingCommitted: (sessionId: string) => void
  readonly bindingFailed: (sessionId: string, error: unknown) => void
  readonly waitForCompletion: (sessionId: string, signal: AbortSignal) => Promise<AgentRunResult>
}

export async function runAgent(host: AgentRunHost, attempt: AttemptAuthority, request: AgentRunRequest): Promise<AgentRunResult> {
  const profile = host.profile(request.profile)
  const keyComponent = safeKey(request.key)
  const parentSurface = request.parent === undefined ? attempt.rootSurface : SurfaceId(request.parent)
  const journalRequest = {
    surface: request.surface,
    task: request.task,
    profile: profile.name,
    parent: parentSurface,
    template: request.templatePath !== undefined,
  }
  return host.agentJournal.run({
    attemptId: attempt.id,
    key: request.key,
    type: 'agent.run',
    request: journalRequest,
    ...(request.retry ? { retry: true } : {}),
    reconcile: async () => {
      const binding = await host.store.readSessionBinding({ surface: request.surface }).catch((error: unknown) => {
        if (error instanceof WorkSurfaceError && error.code === 'not-found') return undefined
        throw error
      })
      if (binding?.completion !== undefined) {
        assertBindingMatches(binding, attempt, request, profile)
        assertRecoverableDelegation(binding)
        return binding.completion
      }
      return readJsonOptional<AgentRunResult>(join(attempt.root, 'runtime', 'agents', keyComponent, 'result.json'))
    },
    execute: async () => {
      if (attempt.activeAgents >= profile.maxParallel) {
        throw new WorkSurfaceError('effect-failed', `profile '${profile.name}' parallel limit ${profile.maxParallel} reached`)
      }
      attempt.activeAgents += 1
      try {
        await admitSurface(host.store, attempt, request, parentSurface)
        const head = await host.store.readHead(request.surface)
        const runRoot = join(attempt.root, 'runtime', 'agents', keyComponent)
        const projection = await host.projections.compile({
          surface: request.surface,
          profile: profile.name,
          tokenBudget: profile.tokenBudget,
          revision: head.revision,
        })
        await mkdir(runRoot, { recursive: true, mode: 0o700 })
        await writeFileAtomic(join(runRoot, 'projection.json'), `${JSON.stringify(projection, null, 2)}\n`, {
          mode: 0o600,
          dirMode: 0o700,
        })
        try {
          host.ctx.emit('worksurface/agent-start', { attemptId: attempt.id, surface: request.surface, profile: profile.name })
        } catch {
          // Lifecycle observers cannot control child execution.
        }

        let binding = await host.store.readSessionBinding({ surface: request.surface })
        if (binding?.completion !== undefined) {
          assertBindingMatches(binding, attempt, request, profile)
          assertRecoverableDelegation(binding)
          return persistResult(host, attempt, request, keyComponent, binding.sessionId, binding.completion)
        }
        if (binding !== undefined) {
          assertBindingMatches(binding, attempt, request, profile)
          assertRecoverableDelegation(binding)
          await host.resumeContinuable(attempt.parent, binding, request.task, request.signal)
        } else {
          const persona = childPersona(
            profile,
            request.surface,
            renderFileProjection(projection),
            projection.surfaceRevision,
            '$DSH_WS_WORKING_PATH',
          )
          const childId = await host.startContinuable(profile, attempt.parent, request.surface, request.task, persona, request.signal)
          try {
            binding = await host.store.bindSession({
              surface: request.surface,
              sessionId: childId,
              role: 'delegated',
              execution: 'continuable',
              rootSurface: attempt.rootSurface,
              parentSessionId: String(attempt.parent.id),
              input: {
                surfaceRevision: projection.surfaceRevision,
                blockRevisions: projection.blockRevisions,
                omittedBlockRevisions: projection.omittedFiles.map(file => ({
                  surface: file.surfaceId,
                  block: file.blockId,
                  revision: file.revision,
                })),
                profile: projection.profile,
                task: request.task,
              },
            })
          } catch (error) {
            host.bindingFailed(childId, error)
            throw error
          }
          host.bindingCommitted(childId)
          await writeBindingAudit(runRoot, childId, request.surface)
        }
        const completion = await host.waitForCompletion(binding.sessionId, request.signal)
        return persistResult(host, attempt, request, keyComponent, binding.sessionId, completion)
      } finally {
        attempt.activeAgents -= 1
      }
    },
  })
}

async function admitSurface(
  store: WorkSurfaceStore,
  attempt: AttemptAuthority,
  request: AgentRunRequest,
  parent: SurfaceIdType,
): Promise<void> {
  if (attempt.surfaces.has(parent) === false) {
    throw new WorkSurfaceError('unauthorized', `attempt cannot create under Surface '${parent}'`)
  }
  if (attempt.surfaces.has(request.surface) === false && request.templatePath === undefined) {
    const binding = await store.readSessionBinding({ surface: request.surface }).catch(error => {
      if (error instanceof WorkSurfaceError && error.code === 'not-found') return undefined
      throw error
    })
    if (binding?.role !== 'delegated'
      || binding.rootSurface !== attempt.rootSurface
      || binding.parentSessionId !== String(attempt.parent.id)) {
      throw new WorkSurfaceError('unauthorized', `attempt cannot access Surface '${request.surface}'`)
    }
  }
  const exists = await store.hasSurface(request.surface)
  if (!exists) {
    if (request.templatePath === undefined) throw new WorkSurfaceError('not-found', `Surface '${request.surface}' does not exist`)
    await store.newSurface({
      attemptId: attempt.id,
      key: `${request.key}-surface`,
      templatePath: request.templatePath,
      parent,
      surface: request.surface,
      ...(request.retry ? { retry: true } : {}),
    })
  } else {
    if (attempt.surfaces.has(request.surface) === false) {
      const binding = await store.readSessionBinding({ surface: request.surface })
      const recoverableProvisional = binding === undefined && request.templatePath !== undefined
      const recoverableBinding = binding?.role === 'delegated'
        && binding.rootSurface === attempt.rootSurface
        && binding.parentSessionId === String(attempt.parent.id)
      if (!recoverableProvisional && !recoverableBinding) {
        throw new WorkSurfaceError('unauthorized', `attempt cannot access Surface '${request.surface}'`)
      }
    }
    const session = await store.sessions.read(request.surface)
    if (session.header.parentSurfaceId !== parent) {
      throw new WorkSurfaceError('unauthorized', `existing Surface '${request.surface}' belongs to another structural parent`)
    }
  }
  attempt.surfaces.add(request.surface)
}

function assertBindingMatches(
  binding: SurfaceSessionBinding,
  attempt: AttemptAuthority,
  request: AgentRunRequest,
  profile: WorkSurfaceProfile,
): void {
  if (binding.role !== 'delegated'
    || binding.rootSurface !== attempt.rootSurface
    || binding.parentSessionId !== String(attempt.parent.id)
    || binding.input?.profile !== profile.name
    || (binding.input.task !== undefined && binding.input.task !== request.task)) {
    throw new WorkSurfaceError('session-binding-conflict', `Surface '${binding.surface}' is bound to a different delegation`)
  }
}

function assertRecoverableDelegation(binding: SurfaceSessionBinding): void {
  if (binding.completion !== undefined) return
  if (binding.version === 2 && binding.role === 'delegated' && binding.execution === 'continuable') return
  throw new WorkSurfaceError('session-binding-conflict',
    `Session '${binding.sessionId}' uses legacy binding v${binding.version} and cannot be cold-resumed safely; preserve it and re-delegate explicitly`,
    { surface: binding.surface, sessionId: binding.sessionId, bindingVersion: binding.version })
}

async function persistResult(
  host: AgentRunHost,
  attempt: AttemptAuthority,
  request: AgentRunRequest,
  keyComponent: string,
  childId: string,
  completion: AgentRunResult,
): Promise<AgentRunResult> {
  const runRoot = join(attempt.root, 'runtime', 'agents', keyComponent)
  await writeFileAtomic(join(runRoot, 'result.json'), `${JSON.stringify(completion, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  await writeBindingAudit(runRoot, childId, request.surface)
  try {
    host.ctx.emit('worksurface/agent-end', { attemptId: attempt.id, agentId: childId, ...completion })
  } catch {
    // Lifecycle observers cannot change a committed child result.
  }
  return completion
}

async function writeBindingAudit(runRoot: string, childId: string, surface: string): Promise<void> {
  await writeFileAtomic(join(runRoot, 'binding.json'), `${JSON.stringify({ agentId: childId, surface }, null, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}
