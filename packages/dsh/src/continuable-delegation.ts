import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import { ProjectionCompiler, sha256, WorkSurfaceError, WorkSurfaceStore } from '@pf-worksurface/core'
import type { SurfaceSessionBinding, WorkSessionEvent } from '@pf-worksurface/core'
import { parseAgentCompletion } from './agent-completion.ts'
import { renderFileProjection } from './model/file-projection.ts'
import type { AgentCompletion, AttemptAuthority, ChildCredential, WorkSurfaceProfile } from './types.ts'

interface PendingStart {
  readonly parentId: string
  readonly result: Promise<string | undefined>
  readonly resolve: (childId: string | undefined) => void
}

interface ActivationState {
  readonly agentId: string
  readonly authority: AttemptAuthority
  readonly credential: ChildCredential
  readonly projectionText: string
  readonly root: string
}

interface CompletionWaiter {
  readonly resolve: (completion: AgentCompletion) => void
  readonly reject: (error: unknown) => void
  cleanup(): void
}

/**
 * Owns the durable child-Session half of WorkSurface delegation.
 *
 * Surface/session binding is the recovery address. Every continuable Activation
 * rebuilds a disposable checkout and a fresh least-authority token from that
 * canonical record before model prompt assembly is allowed to continue.
 */
export class ContinuableDelegationRuntime {
  private readonly pendingStarts = new Set<PendingStart>()
  private readonly bindingSignals = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  private readonly activations = new Map<string, ActivationState>()
  private readonly authorities = new Map<string, AttemptAuthority>()
  private readonly residents = new Set<string>()
  private readonly completionWaiters = new Map<string, Set<CompletionWaiter>>()

  constructor(
    private readonly ctx: Context,
    private readonly store: WorkSurfaceStore,
    private readonly projections: ProjectionCompiler,
    private readonly profile: (name: string) => WorkSurfaceProfile,
  ) {
    const restoreSetup = ctx.subagents.registerContinuableSetup(childCtx => this.installActivationSetup(childCtx))
    ctx.effect(() => restoreSetup, 'worksurface.continuableSetup()')
    ctx.on('subagent/start', info => this.onSubagentStart(info))
    ctx.on('subagent/end', info => this.onSubagentEnd(info))
  }

  /** Authorities admitted by the current continuable Activation epoch. */
  get activeAuthorities(): ReadonlyMap<string, AttemptAuthority> {
    return this.authorities
  }

  /** Resolve a mounted durable child by Agent id for b2f and shell environment routing. */
  childBinding(agentId: string): { attempt: AttemptAuthority; credential: ChildCredential } | undefined {
    const activation = this.activations.get(agentId)
    return activation === undefined ? undefined : { attempt: activation.authority, credential: activation.credential }
  }

  /** Start one durable child Session and return after its first message is accepted. */
  async start(
    profile: WorkSurfaceProfile,
    parent: Agent,
    surface: string,
    task: string,
    persona: string,
    signal: AbortSignal,
  ): Promise<string> {
    const deferred = Promise.withResolvers<string | undefined>()
    const pending: PendingStart = { parentId: String(parent.id), result: deferred.promise, resolve: deferred.resolve }
    this.pendingStarts.add(pending)
    try {
      const started = await this.ctx.subagents.startContinuable({
        provider: profile.provider,
        label: `WorkSurface ${surface}`,
        request: {
          prompt: [{ type: 'text', text: task }],
          parent,
          maxDepth: profile.maxDepth,
          ...(profile.toolAllow === undefined ? {} : { toolFilter: { allow: profile.toolAllow } }),
          persona,
          ...profile.agentProvider === undefined && profile.agentModel === undefined
            ? {}
            : {
              agentOptions: {
                ...(profile.agentProvider === undefined ? {} : { provider: profile.agentProvider }),
                ...(profile.agentModel === undefined ? {} : { model: profile.agentModel }),
              },
            },
        },
        signal,
      })
      const childId = String(started.childId)
      if (this.bindingSignals.has(childId)) {
        throw new WorkSurfaceError('canonical-corrupt', `Session '${childId}' already has a binding barrier`)
      }
      const bindingSignal = Promise.withResolvers<void>()
      // Mark a possible early rejection as observed. Activation setup still
      // awaits the original promise and receives the same rejection.
      void bindingSignal.promise.catch(() => undefined)
      this.bindingSignals.set(childId, bindingSignal)
      pending.resolve(childId)
      return childId
    } catch (error) {
      pending.resolve(undefined)
      throw error
    } finally {
      this.pendingStarts.delete(pending)
    }
  }

  /** Wake the same durable Session only when it has no currently observed Activation. */
  async resume(parent: Agent, binding: SurfaceSessionBinding, task: string, signal: AbortSignal): Promise<void> {
    if (binding.execution !== 'continuable') {
      throw new WorkSurfaceError('session-binding-conflict', `Session '${binding.sessionId}' is not continuable`)
    }
    if (this.residents.has(binding.sessionId)) return
    await this.ctx.subagents.followup(parent, binding.sessionId as never, [{
      type: 'text',
      text: `Resume the existing WorkSurface delegation for ${binding.surface}. The durable task is: ${task}\n`
        + 'Re-read the authoritative activation Projection and DSH_WS_* environment, inspect the current committed Surface, '
        + 'finish any remaining work, commit from DSH_WS_WORKING_PATH using DSH_WS_BASE_REVISION, then return only the required JSON completion.',
    }], {
      source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id } as never,
      signal,
    })
  }

  /** Release a creation-time setup barrier after its Surface/session binding is durable. */
  bindingCommitted(sessionId: string): void {
    this.bindingSignals.get(sessionId)?.resolve()
  }

  /** Fail a creation-time setup barrier when the canonical bind transaction failed. */
  bindingFailed(sessionId: string, error: unknown): void {
    this.bindingSignals.get(sessionId)?.reject(error)
  }

  /** Await canonical completion, surviving loss of attempt-local result files. */
  async waitForCompletion(sessionId: string, signal: AbortSignal): Promise<AgentCompletion> {
    const existing = await this.readCompletion(sessionId)
    if (existing !== undefined) return existing
    signal.throwIfAborted()
    return new Promise<AgentCompletion>((resolve, reject) => {
      const waiter: CompletionWaiter = { resolve, reject, cleanup: () => cleanup() }
      const waiters = this.completionWaiters.get(sessionId) ?? new Set<CompletionWaiter>()
      waiters.add(waiter)
      this.completionWaiters.set(sessionId, waiters)
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort)
        waiters.delete(waiter)
        if (waiters.size === 0) this.completionWaiters.delete(sessionId)
      }
      const abort = (): void => {
        cleanup()
        reject(signal.reason instanceof Error ? signal.reason : new WorkSurfaceError('cancelled', 'delegation wait was cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      void this.readCompletion(sessionId).then((completion) => {
        if (completion === undefined || !waiters.has(waiter)) return
        cleanup()
        resolve(completion)
      }, (error) => {
        if (!waiters.has(waiter)) return
        cleanup()
        reject(error)
      })
    })
  }

  private installActivationSetup(childCtx: Context): () => void {
    const child = (childCtx as Context & { agent: Agent }).agent
    const parentId = String(child.session.header.parentSession ?? '')
    const pending = [...this.pendingStarts].filter(start => start.parentId === parentId)
    const ready = this.prepareActivation(child, pending)
    const restorePrompt = childCtx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const activation = await ready
      const transformed = await next()
      if (activation === undefined || context.agent !== child) return transformed
      transformed.contexts.push({
        name: 'worksurface:delegation-activation',
        text: activation.projectionText,
      })
      return transformed
    })
    return () => {
      restorePrompt()
      void ready.then(activation => this.releaseActivation(child, activation), () => undefined)
    }
  }

  private async prepareActivation(child: Agent, pending: readonly PendingStart[]): Promise<ActivationState | undefined> {
    const binding = await this.resolveActivationBinding(child, pending)
    if (binding === undefined || binding.role !== 'delegated' || binding.execution !== 'continuable'
      || binding.input === undefined || binding.completion !== undefined) {
      return undefined
    }
    const profile = this.profile(binding.input.profile)
    const head = await this.store.readHead(binding.surface)
    const activationId = delegationAttemptId(binding.sessionId)
    const root = join(this.store.runtimeRoot, 'delegated-agents', sha256(binding.sessionId))
    const workspaceRoot = join(root, 'workspace')
    const workingPath = join(workspaceRoot, 'work', binding.surface)
    await rm(root, { recursive: true, force: true })
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    await this.store.checkout({ surface: binding.surface, targetPath: workingPath, revision: head.revision })
    const projection = await this.projections.compile({
      surface: binding.surface,
      profile: profile.name,
      tokenBudget: profile.tokenBudget,
      revision: head.revision,
    })
    const credential: ChildCredential = {
      attemptId: activationId,
      token: randomBytes(32).toString('hex'),
      surface: binding.surface,
      workingPath,
      baseRevision: head.revision,
      ready: Promise.resolve(),
    }
    const authority: AttemptAuthority = {
      id: activationId,
      token: randomBytes(32).toString('hex'),
      rootSurface: binding.rootSurface,
      root,
      workspaceRoot,
      workspaceSurface: binding.surface,
      rootWorkingPath: workingPath,
      rootBaseRevision: head.revision,
      workspaceHash: sha256(`${binding.sessionId}\0${head.revision}`),
      parent: child,
      surfaces: new Set([binding.surface]),
      childCredentials: new Map([[binding.sessionId, credential]]),
      operations: new Set(),
      activeAgents: 0,
    }
    const activation: ActivationState = {
      agentId: binding.sessionId,
      authority,
      credential,
      root,
      projectionText: 'Authoritative WorkSurface activation state (newer than any earlier delegation snapshot):\n\n'
        + `${renderFileProjection(projection)}\n\n`
        + `The current checkout is ${workingPath}; the exact commit base revision is ${head.revision}. `
        + 'Use the DSH_WS_* environment for these values.',
    }
    this.activations.set(binding.sessionId, activation)
    this.authorities.set(activationId, authority)
    return activation
  }

  private async resolveActivationBinding(child: Agent, pending: readonly PendingStart[]): Promise<SurfaceSessionBinding | undefined> {
    const sessionId = String(child.id)
    const existing = await this.store.readSessionBinding({ sessionId })
    if (existing !== undefined) return existing
    if (pending.length === 0) return undefined
    const candidates = await Promise.all(pending.map(start => start.result))
    if (!candidates.includes(sessionId)) return undefined
    const signal = this.bindingSignals.get(sessionId)
    if (signal === undefined) {
      throw new WorkSurfaceError('canonical-corrupt', `Session '${sessionId}' activation has no binding barrier`)
    }
    const raced = await this.store.readSessionBinding({ sessionId })
    if (raced !== undefined) {
      signal.resolve()
      this.bindingSignals.delete(sessionId)
      return raced
    }
    try {
      await signal.promise
    } finally {
      this.bindingSignals.delete(sessionId)
    }
    const bound = await this.store.readSessionBinding({ sessionId })
    if (bound === undefined) throw new WorkSurfaceError('canonical-corrupt', `Session '${sessionId}' activation was released without a binding`)
    return bound
  }

  private releaseActivation(child: Agent, activation: ActivationState | undefined): void {
    if (activation === undefined || this.activations.get(String(child.id)) !== activation) return
    this.activations.delete(String(child.id))
    this.authorities.delete(activation.authority.id)
    void rm(activation.root, { recursive: true, force: true })
  }

  private onSubagentStart(info: SubagentRunInfo): void {
    this.residents.add(String(info.id))
  }

  private onSubagentEnd(info: SubagentRunEndInfo): void {
    const sessionId = String(info.id)
    this.residents.delete(sessionId)
    void this.captureCompletion(info).then(
      completion => {
        if (completion !== undefined) this.settleWaiters(sessionId, completion)
      },
      error => {
        this.rejectWaiters(sessionId, error)
        this.ctx.logger.warn(`WorkSurface continuable child '${sessionId}' did not produce a valid completion: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  private async captureCompletion(info: SubagentRunEndInfo): Promise<AgentCompletion | undefined> {
    const binding = await this.store.readSessionBinding({ sessionId: String(info.id) })
    if (binding === undefined || binding.execution !== 'continuable') return undefined
    if (binding.completion !== undefined) return binding.completion
    if (info.stopReason !== 'completed') {
      throw new WorkSurfaceError('effect-failed', `child Agent stopped with '${info.stopReason}'`)
    }
    const text = completionText(info.lastAssistantMessage)
    let decoded: unknown
    try {
      decoded = JSON.parse(text)
    } catch {
      throw new WorkSurfaceError('invalid-reference', 'child Agent final message is not the required JSON completion')
    }
    const completion = parseAgentCompletion(decoded)
    await this.validateAndStoreCompletion(binding, completion)
    return completion
  }

  private async validateAndStoreCompletion(binding: SurfaceSessionBinding, completion: AgentCompletion): Promise<void> {
    if (completion.surface !== binding.surface || completion.outputs.some(output => output.surface !== binding.surface)) {
      throw new WorkSurfaceError('unauthorized', 'child Agent returned an output from another Surface')
    }
    const current = await this.store.readHead(binding.surface)
    if (binding.input !== undefined && current.revision === binding.input.surfaceRevision) {
      throw new WorkSurfaceError('invalid-reference', 'child Agent completed without committing its assigned working copy')
    }
    if (completion.surfaceRevision !== current.revision || completion.outputs.some(output => output.revision !== current.revision)) {
      throw new WorkSurfaceError('invalid-reference', 'child completion is not pinned to the current committed Surface revision', {
        returned: completion.surfaceRevision,
        current: current.revision,
      })
    }
    const workSession = await this.store.readWorkSession(binding.surface)
    const publication = workSession.events.findLast(event => event.type === 'surface/revision-published') as
      WorkSessionEvent<'surface/revision-published'> | undefined
    if (publication?.data.revision !== current.revision
      || publication.attemptId !== delegationAttemptId(binding.sessionId)) {
      throw new WorkSurfaceError('unauthorized', 'child completion points to a revision committed outside its current delegation authority', {
        surface: binding.surface,
        revision: current.revision,
        expectedAttemptId: delegationAttemptId(binding.sessionId),
        actualAttemptId: publication?.attemptId,
      })
    }
    await this.store.validateOutputRefs(completion.outputs)
    await this.store.completeSessionBinding(binding.surface, binding.sessionId, completion)
  }

  private async readCompletion(sessionId: string): Promise<AgentCompletion | undefined> {
    const binding = await this.store.readSessionBinding({ sessionId })
    return binding?.completion
  }

  private settleWaiters(sessionId: string, completion: AgentCompletion): void {
    const waiters = this.completionWaiters.get(sessionId)
    if (waiters === undefined) return
    this.completionWaiters.delete(sessionId)
    for (const waiter of waiters) {
      waiter.cleanup()
      waiter.resolve(completion)
    }
  }

  private rejectWaiters(sessionId: string, error: unknown): void {
    const waiters = this.completionWaiters.get(sessionId)
    if (waiters === undefined) return
    this.completionWaiters.delete(sessionId)
    for (const waiter of waiters) {
      waiter.cleanup()
      waiter.reject(error)
    }
  }
}

function delegationAttemptId(sessionId: string): string {
  return `delegation-${sha256(sessionId).slice(0, 24)}`
}

function completionText(content: SubagentRunEndInfo['lastAssistantMessage']): string {
  if (content === undefined || content.length === 0 || content.some(block => block.type !== 'text')) {
    throw new WorkSurfaceError('invalid-reference', 'child Agent final message must contain only JSON text')
  }
  const text = content.map(block => block.type === 'text' ? block.text : '').join('').trim()
  if (text === '') throw new WorkSurfaceError('invalid-reference', 'child Agent final message is empty')
  return text
}
