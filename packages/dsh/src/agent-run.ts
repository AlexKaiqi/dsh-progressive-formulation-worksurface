import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Context } from '@deepseek-ai/cordis'
import { EffectJournal, ProjectionCompiler, SurfaceId, WorkSurfaceError, WorkSurfaceStore } from '@pf-worksurface/core'
import type { SurfaceIdType } from '@pf-worksurface/core'
import { AGENT_OUTPUT_SCHEMA, childPersona } from './model/child-agent.ts'
import { renderFileProjection } from './model/file-projection.ts'
import { parseAgentCompletion } from './agent-completion.ts'
import { readJsonOptional } from './json.ts'
import { safeKey } from './params.ts'
import type { AgentRunResult, AttemptAuthority, ChildCredential, WorkSurfaceProfile } from './types.ts'

export interface AgentRunHarness {
  readonly sandbox: Context['sandbox']
  readonly subagents: Context['subagents']
  readonly subprocess: Context['subprocess']
}

export interface AgentRunRequest {
  readonly surface: SurfaceIdType
  readonly task: string
  readonly profile: string
  readonly key: string
  /** Optional template directory that creates the Surface when it does not exist yet. */
  readonly templatePath?: string
  /** Optional structural parent for a Surface created by this delegation; defaults to the attempt root. */
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
  readonly requireHarness: () => AgentRunHarness
}

export async function runAgent(
  host: AgentRunHost,
  attempt: AttemptAuthority,
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  const profile = host.profile(request.profile)
  const keyComponent = safeKey(request.key)
  const journalRequest = {
    surface: request.surface,
    task: request.task,
    profile: profile.name,
  }
  return host.agentJournal.run({
    attemptId: attempt.id,
    key: request.key,
    type: 'agent.run',
    request: journalRequest,
    ...(request.retry ? { retry: true } : {}),
    reconcile: async () => readJsonOptional<AgentRunResult>(join(attempt.root, 'runtime', 'agents', keyComponent, 'result.json')),
    execute: async () => {
      if (attempt.activeAgents >= profile.maxParallel) {
        throw new WorkSurfaceError('effect-failed', `profile '${profile.name}' parallel limit ${profile.maxParallel} reached`)
      }
      attempt.activeAgents += 1
      let childId: string | undefined
      try {
        // A delegated work unit is created by its delegation: when the Surface
        // does not exist yet, materialize it from the provided template first.
        if (request.templatePath !== undefined && !(await host.store.hasSurface(request.surface))) {
          const parent = request.parent === undefined ? attempt.rootSurface : SurfaceId(request.parent)
          if (attempt.surfaces.has(parent) === false) {
            throw new WorkSurfaceError('unauthorized', `attempt cannot create under Surface '${parent}'`)
          }
          await host.store.newSurface({
            attemptId: attempt.id,
            key: `${request.key}-surface`,
            templatePath: request.templatePath,
            parent,
            surface: request.surface,
            ...(request.retry ? { retry: true } : {}),
          })
          attempt.surfaces.add(request.surface)
        }
        const head = await host.store.readHead(request.surface)
        const runRoot = join(attempt.root, 'runtime', 'agents', keyComponent)
        const workingPath = join(attempt.workspaceRoot, 'work', `${request.surface}-${keyComponent}`)
        const projection = await host.projections.compile({
          surface: request.surface,
          profile: profile.name,
          tokenBudget: profile.tokenBudget,
          revision: head.revision,
        })
        await mkdir(runRoot, { recursive: true, mode: 0o700 })
        await writeFileAtomic(join(runRoot, 'projection.json'), `${JSON.stringify(projection, null, 2)}
`, { mode: 0o600, dirMode: 0o700 })
        await rm(workingPath, { recursive: true, force: true })
        await host.store.checkout({ surface: request.surface, targetPath: workingPath, revision: head.revision })
        const childToken = randomBytes(32).toString('hex')
        try {
          host.ctx.emit('worksurface/agent-start', {
            attemptId: attempt.id,
            surface: request.surface,
            profile: profile.name,
          })
        } catch {
          // Lifecycle observers cannot control child execution.
        }
        const run = await host.requireHarness().subagents.start(profile.provider, {
          label: `WorkSurface ${request.surface}`,
          prompt: [{ type: 'text', text: request.task }],
          parent: attempt.parent,
          signal: request.signal,
          outputSchema: AGENT_OUTPUT_SCHEMA,
          maxDepth: profile.maxDepth,
          ...(profile.toolAllow === undefined ? {} : { toolFilter: { allow: profile.toolAllow } }),
          persona: childPersona(
            profile,
            request.surface,
            renderFileProjection(projection),
            projection.surfaceRevision,
            workingPath,
          ),
          ...profile.agentProvider === undefined && profile.agentModel === undefined
            ? {}
            : {
              agentOptions: {
                ...(profile.agentProvider === undefined ? {} : { provider: profile.agentProvider }),
                ...(profile.agentModel === undefined ? {} : { model: profile.agentModel }),
              },
            },
        })
        childId = run.id
        if (run.localAgent === undefined) {
          await run.dispose()
          throw new WorkSurfaceError('unsupported-profile', `profile '${profile.name}' must use an in-process subagent provider`)
        }
        const ready = host.store.bindSession({
          surface: request.surface,
          sessionId: run.id,
          role: 'delegated',
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
          },
        }).then(() => undefined)
        const credential: ChildCredential = {
          attemptId: attempt.id,
          token: childToken,
          surface: request.surface,
          workingPath,
          baseRevision: head.revision,
          ready,
        }
        attempt.childCredentials.set(run.id, credential)
        let settled: Awaited<typeof run.result>
        try {
          await ready
          settled = await run.result
        } finally {
          await run.dispose()
          attempt.childCredentials.delete(run.id)
        }
        if (settled.stopReason !== 'completed') {
          throw new WorkSurfaceError('effect-failed', `child Agent stopped with '${settled.stopReason}'`)
        }
        const completion = parseAgentCompletion(settled.structured)
        if (completion.surface !== request.surface) {
          throw new WorkSurfaceError('unauthorized', 'child Agent returned a different Surface')
        }
        for (const output of completion.outputs) {
          if (output.surface !== request.surface) {
            throw new WorkSurfaceError('unauthorized', 'child Agent returned an output from another Surface')
          }
        }
        const current = await host.store.readHead(request.surface)
        if (current.commitId === head.commitId) {
          throw new WorkSurfaceError('invalid-reference', 'child Agent completed without committing its assigned working copy')
        }
        if (completion.surfaceRevision !== current.revision) {
          throw new WorkSurfaceError('invalid-reference', 'child surfaceRevision is not the committed current revision', {
            returned: completion.surfaceRevision,
            current: current.revision,
          })
        }
        for (const output of completion.outputs) {
          if (output.revision !== current.revision) {
            throw new WorkSurfaceError('invalid-reference', 'child output is not pinned to the committed current Surface revision', {
              output,
              current: current.revision,
            })
          }
        }
        await host.store.validateOutputRefs(completion.outputs)
        await host.store.completeSessionBinding(request.surface, run.id, completion.surfaceRevision)
        await writeFileAtomic(join(runRoot, 'result.json'), `${JSON.stringify(completion, null, 2)}
`, { mode: 0o600, dirMode: 0o700 })
        await writeFileAtomic(join(runRoot, 'binding.json'), `${JSON.stringify({ agentId: childId, surface: request.surface }, null, 2)}
`, {
          mode: 0o600,
          dirMode: 0o700,
        })
        try {
          host.ctx.emit('worksurface/agent-end', {
            attemptId: attempt.id,
            agentId: run.id,
            ...completion,
          })
        } catch {
          // Lifecycle observers cannot change a committed child result.
        }
        return completion
      } finally {
        attempt.activeAgents -= 1
        if (childId !== undefined) attempt.childCredentials.delete(childId)
      }
    },
  })
}
