import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { WorkSurfaceError } from '@pf-worksurface/core'
import type { SurfaceInputSource, SurfaceSessionBinding, SurfaceSessionService } from './session-surface.ts'

interface AgentRegistryPort {
  get(id: ReturnType<typeof SessionId>): Agent | undefined
  create(options: {
    sessionId: ReturnType<typeof SessionId>
    meta: { cwd: string; agentPreset?: string }
    agentOptions: { provider: string; model: string }
    signal?: AbortSignal
    setup(agentCtx: Context): Promise<void>
  }): Promise<AgentHandle>
  resume(options: {
    resumeSessionId: ReturnType<typeof SessionId>
    agentOptions: { provider: string; model: string }
    signal?: AbortSignal
    setup(agentCtx: Context): Promise<void>
  }): Promise<AgentHandle>
}

interface AgentPresetPort {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(agentCtx: Context, id?: string): Promise<{ readonly id: string }>
}

interface SessionPersistencePort {
  list(signal?: AbortSignal): Promise<readonly { readonly id: ReturnType<typeof SessionId> }[]>
  inspect(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<{
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
  }>
}

interface SurfaceSessionRuntime {
  readonly agents: AgentRegistryPort
  readonly agentDefaultModel: { currentSelection(): ModelSelection }
  readonly logger?: { warn(message: string): void }
  get(name: string): unknown
}

export interface SurfaceSessionAdmissionRequest {
  readonly surfaceId: string
  readonly source?: SurfaceInputSource
  readonly signal?: AbortSignal
}

export interface SurfaceSessionAdmissionResult {
  readonly surfaceId: string
  readonly sessionId: string
  readonly created: boolean
  readonly resumed: boolean
}

export interface SurfaceSessionRecoveryResult {
  readonly surfaceId: string
  readonly sessionId: string
  readonly cause: 'interrupted' | 'disposed' | 'queued-followup'
}

interface RecoveryCandidate extends SurfaceSessionRecoveryResult {
  readonly hasQueuedFollowup: boolean
}

const RESTART_CONTINUATION = [
  'DSH restarted while this WorkSurface Session still had unfinished work.',
  'Continue the same Surface from its durable Session history and current worktree.',
  'First reconcile the worktree and any tool call whose outcome may be uncertain; do not blindly repeat non-idempotent external side effects.',
].join(' ')

/**
 * Product admission into the native DSH lifecycle. Ensuring a Surface creates
 * or resumes its one Session but never fabricates a user message or Turn.
 */
export class SurfaceSessionAdmission {
  private readonly runtime: SurfaceSessionRuntime
  private readonly surfaceOperations = new Map<string, Promise<void>>()
  private startupRecovery: Promise<readonly SurfaceSessionRecoveryResult[]> | undefined

  constructor(
    ctx: Context,
    private readonly surfaces: SurfaceSessionService,
    private readonly ready: () => Promise<void>,
  ) {
    this.runtime = ctx as unknown as SurfaceSessionRuntime
  }

  ensure(request: SurfaceSessionAdmissionRequest): Promise<SurfaceSessionAdmissionResult> {
    const previous = this.surfaceOperations.get(request.surfaceId) ?? Promise.resolve()
    const operation = previous.then(async () => {
      await this.ready()
      request.signal?.throwIfAborted()
      return this.ensureSerialized(request)
    })
    const settled = operation.then(() => undefined, () => undefined)
    this.surfaceOperations.set(request.surfaceId, settled)
    void settled.finally(() => {
      if (this.surfaceOperations.get(request.surfaceId) === settled) this.surfaceOperations.delete(request.surfaceId)
    })
    return operation
  }

  /**
   * Resume only durable work that a Host restart interrupted. A balanced idle
   * Session stays cold; waiting-user and completed Turns are never inferred as
   * unfinished from Surface state.
   */
  recoverAfterRestart(signal?: AbortSignal): Promise<readonly SurfaceSessionRecoveryResult[]> {
    if (this.startupRecovery !== undefined) return this.startupRecovery
    this.startupRecovery = this.recoverAfterRestartOnce(signal)
    void this.startupRecovery.catch(() => { this.startupRecovery = undefined })
    return this.startupRecovery
  }

  private async recoverAfterRestartOnce(signal?: AbortSignal): Promise<readonly SurfaceSessionRecoveryResult[]> {
    await this.ready()
    signal?.throwIfAborted()
    const persistence = this.persistence()
    if (persistence === undefined) {
      throw new WorkSurfaceError(
        'effect-failed',
        'automatic WorkSurface restart recovery requires the DSH Session persistence service',
      )
    }
    const persisted = new Set((await persistence.list(signal)).map(header => String(header.id)))
    const bindings = this.surfaces.listBindings()
    const inspected = await Promise.allSettled(bindings.map(async binding => {
      const sessionId = SessionId(binding.sessionId)
      if (this.runtime.agents.get(sessionId) !== undefined) return undefined
      // A binding can legitimately precede lazy Session materialization. It has
      // no durable Turn to recover; a later admission recreates the same id.
      if (!persisted.has(binding.sessionId)) return undefined
      const inspection = await persistence.inspect(sessionId, signal)
      signal?.throwIfAborted()
      const queued = pendingNextTurn(inspection.meta, inspection.events)
      const interruption = restartInterruption(inspection.events)
      if (queued.length === 0 && interruption === undefined) return undefined
      return {
        surfaceId: binding.surfaceId,
        sessionId: binding.sessionId,
        cause: queued.length > 0 ? 'queued-followup' : interruption!,
        hasQueuedFollowup: queued.length > 0,
      } satisfies RecoveryCandidate
    }))
    const candidates: RecoveryCandidate[] = []
    for (const [index, result] of inspected.entries()) {
      if (result.status === 'fulfilled') {
        if (result.value !== undefined) candidates.push(result.value)
      } else {
        this.runtime.logger?.warn(
          `WorkSurface Session inspection '${bindings[index]!.sessionId}' failed: ${renderError(result.reason)}`,
        )
      }
    }

    const recovered = await Promise.allSettled(candidates.map(candidate => this.recoverCandidate(candidate, signal)))
    const results: SurfaceSessionRecoveryResult[] = []
    for (const [index, result] of recovered.entries()) {
      if (result.status === 'fulfilled') results.push(result.value)
      else this.runtime.logger?.warn(
        `WorkSurface Session recovery '${candidates[index]!.sessionId}' failed: ${renderError(result.reason)}`,
      )
    }
    return results
  }

  private async recoverCandidate(candidate: RecoveryCandidate, signal?: AbortSignal): Promise<SurfaceSessionRecoveryResult> {
    await this.ensure({
      surfaceId: candidate.surfaceId,
      ...(signal === undefined ? {} : { signal }),
    })
    const agent = this.runtime.agents.get(SessionId(candidate.sessionId))
    if (agent === undefined) throw new WorkSurfaceError('effect-failed', `DSH Session '${candidate.sessionId}' was not live after restart recovery`)
    const continuation = createUserMessage({
      content: [{ type: 'text', text: RESTART_CONTINUATION }],
      source: {
        kind: 'plugin',
        plugin: '@pf-worksurface/dsh',
        form: 'notice',
        summary: 'Continuing WorkSurface work interrupted by the DSH restart.',
      },
    })
    // A durable queued next-turn already carries the user's or orchestrator's
    // intent. Steering wakes it and is claimed in the same Turn; otherwise a
    // plugin followup is the new continuation Turn.
    if (candidate.hasQueuedFollowup) agent.steer(continuation)
    else agent.followup(continuation)
    return {
      surfaceId: candidate.surfaceId,
      sessionId: candidate.sessionId,
      cause: candidate.cause,
    }
  }

  private async ensureSerialized(request: SurfaceSessionAdmissionRequest): Promise<SurfaceSessionAdmissionResult> {
    const existing = this.surfaces.bindingForSurface(request.surfaceId)
    if (existing !== undefined && request.source !== undefined && !bindingUses(existing, request.source)) {
      throw new WorkSurfaceError('already-exists-conflict', `Surface '${request.surfaceId}' is already fixed to input ${renderBindingSource(existing)}`)
    }
    const source = existing === undefined
      ? request.source ?? await this.surfaces.defaultInputSource(request.surfaceId)
      : sourceFor(existing)
    const sessionId = SessionId(existing?.sessionId ?? `worksurface-${randomUUID()}`)
    let agent = this.runtime.agents.get(sessionId)
    let created = false
    let resumed = false
    if (agent === undefined) {
      const persisted = await this.isPersisted(sessionId, request.signal)
      if (persisted) {
        const handle = await this.runtime.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: this.agentOptions(),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          setup: agentCtx => this.compose(agentCtx, request.surfaceId, source),
        })
        agent = handle.agent
        resumed = true
      } else {
        const preset = await this.defaultPreset()
        const handle = await this.runtime.agents.create({
          sessionId,
          meta: {
            cwd: this.surfaces.cwdForSurface(request.surfaceId),
            ...(preset === undefined ? {} : { agentPreset: preset }),
          },
          agentOptions: this.agentOptions(),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          setup: agentCtx => this.compose(agentCtx, request.surfaceId, source, preset),
        })
        agent = handle.agent
        created = true
      }
    }
    request.signal?.throwIfAborted()
    return { surfaceId: request.surfaceId, sessionId: String(agent.session.id), created, resumed }
  }

  private async compose(agentCtx: Context, surfaceId: string, source: SurfaceInputSource, preset?: string): Promise<void> {
    const agent = agentCtx.agent
    if (agent === undefined) throw new WorkSurfaceError('effect-failed', 'DSH Agent setup did not expose its unpublished Session')
    const presets = this.runtime.get('agentPresets') as AgentPresetPort | undefined
    if (presets !== undefined) await presets.mount(agentCtx, preset ?? effectivePreset(agent.session))
    await this.surfaces.bindSession(agent.session, surfaceId, source)
  }

  private agentOptions(): { provider: string; model: string } {
    const selection = this.runtime.agentDefaultModel.currentSelection()
    return { provider: selection.provider, model: selection.model }
  }

  private async defaultPreset(): Promise<string | undefined> {
    const presets = this.runtime.get('agentPresets') as AgentPresetPort | undefined
    return presets === undefined ? undefined : (await presets.resolve()).id
  }

  private async isPersisted(sessionId: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<boolean> {
    const persistence = this.persistence()
    if (persistence === undefined) return false
    return (await persistence.list(signal)).some(header => String(header.id) === String(sessionId))
  }

  private persistence(): SessionPersistencePort | undefined {
    return this.runtime.get('sessionPersistence') as SessionPersistencePort | undefined
  }
}

function restartInterruption(events: readonly SessionEvent[]): 'interrupted' | 'disposed' | undefined {
  const ending = events.findLast(event => event.type === 'turn/end')
  if (ending?.type !== 'turn/end') return undefined
  if (ending.data.reason.kind === 'interrupted') return 'interrupted'
  if (ending.data.reason.kind === 'aborted' && ending.data.reason.reason.kind === 'disposed') return 'disposed'
  return undefined
}

/** Fold the same durable next-turn splice vocabulary used by the DSH Inbox. */
function pendingNextTurn(meta: SessionHeader, events: readonly SessionEvent[]): readonly UserMessage[] {
  const pending: UserMessage[] = []
  for (const event of events.slice(meta.seedLength ?? 0)) {
    if (event.type !== 'agent/inbox/spliced' || event.data.target !== 'next-turn') continue
    pending.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
  }
  return pending
}

function sourceFor(binding: SurfaceSessionBinding): SurfaceInputSource {
  return binding.inputSource === 'revision' ? `revision:${binding.inputRevision}` : binding.inputSource
}

function bindingUses(binding: SurfaceSessionBinding, source: SurfaceInputSource): boolean {
  return sourceFor(binding) === source
}

function renderBindingSource(binding: SurfaceSessionBinding): string {
  return JSON.stringify(sourceFor(binding))
}

function effectivePreset(session: Session): string | undefined {
  return session.header.agentPreset
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
