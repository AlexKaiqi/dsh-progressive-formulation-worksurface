import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import type SessionStore from '@deepseek-ai/dsh-session'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkSurfaceError } from '@pf-worksurface/core'
import type { BashEnvContributor, ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import { workSurfaceInstructions } from './model/session-instructions.ts'
import { supportsPersistedIgnorableSessionEvents, type SurfaceSessionService } from './session-surface.ts'
import type { WorkSurfaceContextRuntime } from './context/runtime.ts'
import type { RenderedContext } from './context/types.ts'
import type {} from '@deepseek-ai/dsh-system-prompt'

const WORKSURFACE_CLI = fileURLToPath(import.meta.resolve('@pf-worksurface/cli/bin'))

declare module '@deepseek-ai/cordis' {
  interface Context { shellEnv: ShellEnvRegistry; sessions: SessionStore }
  interface Events {
    'session/event'(session: Session, event: SessionEvent): void
    'session/disposed'(session: Session): void
    'agent/session-start'(payload: { agent: Agent; source: 'startup' | 'resume' | 'clear' | 'compact' }): void
  }
}

/** Connect one WorkSurface service to the Sessions and Turns DSH already owns. */
export class DshWorkSurfaceSessionAdapter {
  private readonly followupReceipts = new Map<string, Set<(turnId: string) => void>>()
  constructor(
    private readonly ctx: Context,
    private readonly service: SurfaceSessionService,
    private readonly contextRuntime: WorkSurfaceContextRuntime | undefined,
    _socketPath: string,
    private readonly ensureSurface?: (surfaceId: string) => Promise<{ readonly sessionId: string }>,
    private readonly prepareNextTurn?: (surfaceId: string) => Promise<void>,
  ) {
    this.registerSessionEvents()
    this.registerShellContext()
    this.registerModelContext()
    this.registerFactBackedContext()
    this.adoptLiveAgents()
    const unregister = this.service.registerFollowupRouter((surfaceId, message, messageId) => this.deliverFollowup(surfaceId, message, messageId))
    this.ctx.effect(() => unregister, 'worksurface.sessionFollowupRouter()')
  }

  private async deliverFollowup(surfaceId: string, message: string, messageId: string): Promise<{ readonly sessionId: string; readonly messageId: string; readonly turnId: string }> {
    let binding = this.service.bindingForSurface(surfaceId)
    let agent = binding === undefined ? undefined : this.ctx.agents.get(SessionId(binding.sessionId))
    if (agent === undefined && this.ensureSurface !== undefined) {
      const ensured = await this.ensureSurface(surfaceId)
      binding = this.service.bindingForSurface(surfaceId)
      if (binding === undefined || binding.sessionId !== ensured.sessionId) {
        throw new WorkSurfaceError('canonical-corrupt', `Surface '${surfaceId}' admission did not retain its unique Session binding`)
      }
      agent = this.ctx.agents.get(SessionId(binding.sessionId))
    }
    if (binding === undefined) throw new WorkSurfaceError('not-found', `Surface '${surfaceId}' has no DSH Session`)
    if (agent === undefined) throw new WorkSurfaceError('effect-failed', `DSH Session '${binding.sessionId}' is not live`)
    let turnId = turnForMessage(agent.session, messageId)
    if (turnId === undefined) {
      const receipt = this.waitForFollowupReceipt(binding.sessionId, messageId)
      try {
        if (!hasMessageReceipt(agent.session, messageId)) {
          agent.followup(freezeMessage({
            id: MessageId(messageId),
            role: 'user' as const,
            content: [{ type: 'text' as const, text: message }],
            source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh' },
          }))
        }
        turnId = await receipt.promise
      } finally {
        receipt.cancel()
      }
    }
    const durable = await this.ctx.sessions.flush(agent.session)
    if (!durable || !hasMessageReceipt(agent.session, messageId) || turnId === undefined) {
      throw new WorkSurfaceError('effect-failed', `DSH Session '${binding.sessionId}' did not durably accept followup '${messageId}'`)
    }
    return { sessionId: binding.sessionId, messageId, turnId }
  }

  private adoptLiveAgents(): void {
    for (const agent of this.ctx.agents.list()) {
      const boundary = agent.session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
      const binding = this.service.attachSession(agent.session)
      if (binding === undefined) continue
      if (boundary?.type === 'turn/start') this.service.beginTurn(agent.session, boundary.data.turn)
      agent.inject(workSurfaceInstructions(binding.surfaceId))
    }
  }

  private registerSessionEvents(): void {
    this.ctx.on('session/event', async (session, event) => {
      if (event.type === 'turn/start') this.service.beginTurn(session, event.data.turn)
      if (event.type === 'user/message') {
        const messageId = String(event.data.id)
        const turnId = turnForMessage(session, messageId)
        if (turnId !== undefined) this.resolveFollowupReceipt(String(session.id), messageId, turnId)
      }
      if (event.type === 'turn/end') {
        const binding = this.service.bindingForSession(String(session.id))
        this.service.endTurn(String(session.id), event.data.turn)
        if (binding !== undefined) await this.prepareNextTurn?.(binding.surfaceId)
      }
    })
    this.ctx.on('session/disposed', session => { this.service.endTurn(String(session.id)) })
  }

  private waitForFollowupReceipt(sessionId: string, messageId: string): { readonly promise: Promise<string>; readonly cancel: () => void } {
    const key = `${sessionId}\0${messageId}`
    let receiver: ((turnId: string) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<string>((resolve, reject) => {
      receiver = resolve
      const receivers = this.followupReceipts.get(key) ?? new Set<(turnId: string) => void>()
      receivers.add(resolve)
      this.followupReceipts.set(key, receivers)
      timer = setTimeout(() => reject(new WorkSurfaceError('effect-failed', `timed out waiting for DSH to accept followup '${messageId}'`)), 30_000)
      timer.unref?.()
    })
    const cancel = () => {
      if (timer !== undefined) clearTimeout(timer)
      const receivers = this.followupReceipts.get(key)
      if (receiver !== undefined) receivers?.delete(receiver)
      if (receivers?.size === 0) this.followupReceipts.delete(key)
    }
    return { promise, cancel }
  }

  private resolveFollowupReceipt(sessionId: string, messageId: string, turnId: string): void {
    const key = `${sessionId}\0${messageId}`
    const receivers = this.followupReceipts.get(key)
    if (receivers === undefined) return
    this.followupReceipts.delete(key)
    for (const resolve of receivers) resolve(turnId)
  }

  private registerModelContext(): void {
    this.ctx.on('agent/session-start', ({ agent }) => {
      const binding = this.service.attachSession(agent.session)
      if (binding !== undefined) agent.inject(workSurfaceInstructions(binding.surfaceId))
    })
  }

  private registerFactBackedContext(): void {
    if (this.contextRuntime === undefined) return
    const runtime = this.contextRuntime
    const pending = new WeakMap<Agent, RenderedContext>()
    this.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const transformed = await next()
      const agent = agentFromScope(context.scope)
      if (agent === undefined) return transformed
      const binding = this.service.bindingForSession(String(agent.session.id))
      const active = this.service.activeSurface(String(agent.session.id))
      if (binding === undefined || active === undefined) return transformed
      // Older DSH Session implementations accept append options but silently
      // discard `ignorable`. Persisting any plugin extension fact there makes
      // the Session unreadable after restart when Host and linked plugin use
      // distinct Session package copies. Turn Brief and shell context remain
      // available, so omit the optional fact-backed context layer as one unit.
      const persistence = (this.ctx as unknown as {
        readonly sessionPersistence?: { readonly borrowSession?: unknown; readonly ensureMaterialized?: unknown }
      }).sessionPersistence
      if (!supportsPersistedIgnorableSessionEvents(agent.session, binding, persistence ?? {})) return transformed
      context.signal?.throwIfAborted()
      const revision = active.revision.outputRevision ?? active.revision.inputRevision
      await runtime.publishRevision(agent, binding.surfaceId, revision, null)
      await runtime.prepareAutomaticOccurrences(agent, context.signal)
      const route = agent.session.requestContext()
      const provider = agent.options.provider ?? route?.provider
      const model = agent.options.model ?? route?.model
      const rendered = await runtime.render(agent, {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(route?.contextWindow === undefined ? {} : { contextWindow: route.contextWindow }),
      })
      transformed.contexts.push(...rendered.contexts)
      pending.set(agent, rendered)
      return transformed
    })
    this.ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const rendered = pending.get(payload.agent)
      if (rendered !== undefined) {
        pending.delete(payload.agent)
        runtime.recordRender(payload.agent, rendered)
      }
      return resolved
    })
  }

  private registerShellContext(): void {
    const contributor: BashEnvContributor = {
      name: 'worksurface-session-v1',
      variables: {
        DSH_WORKSURFACE_CLI: { description: 'Absolute executable path for WorkSurface help and Runtime-authorized emit commands.' },
        DSH_WORKSURFACE_ROOT: { description: 'Writable public authoring root containing surfaces/ and orchestrations/.' },
        DSH_SURFACE_ID: { description: 'The one WorkSurface whose progress this DSH Session records.' },
        DSH_SURFACE_DIR: { description: 'Authoring directory of the one Surface bound to this Session.' },
        DSH_WORKSURFACE_VIEW_DIR: { description: 'Runtime view containing turn-brief.json and authorized payload schemas.' },
      },
      resolve: execution => {
        if (execution.agent === undefined) return {}
        const authoring = { DSH_WORKSURFACE_CLI: WORKSURFACE_CLI, DSH_WORKSURFACE_ROOT: this.service.workRoot }
        const sessionId = String(execution.agent.id)
        const turn = this.service.activeTurn(sessionId)
        if (turn === undefined) return authoring
        const surface = this.service.activeSurface(sessionId)
        if (surface === undefined) return authoring
        return {
          ...authoring,
          DSH_SURFACE_ID: surface.surfaceId,
          DSH_SURFACE_DIR: surface.cwd,
          DSH_WORKSURFACE_VIEW_DIR: surface.viewDir,
        }
      },
    }
    const dispose = this.ctx.shellEnv.register(contributor)
    this.ctx.effect(() => dispose, 'worksurface.sessionShellContextV1()')
  }
}

export function installDshSessionAdapter(
  ctx: Context,
  service: SurfaceSessionService,
  contextRuntimeOrSocketPath: WorkSurfaceContextRuntime | string,
  socketPathOrEnsureSurface?: string | ((surfaceId: string) => Promise<{ readonly sessionId: string }>),
  ensureSurface?: (surfaceId: string) => Promise<{ readonly sessionId: string }>,
  prepareNextTurn?: (surfaceId: string) => Promise<void>,
): DshWorkSurfaceSessionAdapter {
  const contextRuntime = typeof contextRuntimeOrSocketPath === 'string' ? undefined : contextRuntimeOrSocketPath
  const socketPath = typeof contextRuntimeOrSocketPath === 'string' ? contextRuntimeOrSocketPath : socketPathOrEnsureSurface
  if (typeof socketPath !== 'string') throw new TypeError('WorkSurface Session adapter requires a socket path')
  const resolvedEnsure = typeof contextRuntimeOrSocketPath === 'string' && typeof socketPathOrEnsureSurface === 'function'
    ? socketPathOrEnsureSurface
    : ensureSurface
  return new DshWorkSurfaceSessionAdapter(ctx, service, contextRuntime, socketPath, resolvedEnsure, prepareNextTurn)
}

function agentFromScope(scope: unknown): Agent | undefined {
  if (scope === null || typeof scope !== 'object') return undefined
  const candidate = scope as Partial<Agent>
  return candidate.session !== undefined && candidate.options !== undefined ? candidate as Agent : undefined
}

function hasMessageReceipt(session: Session, messageId: string): boolean {
  return session.events.some(event => {
    if (event.type === 'user/message') return String(event.data.id) === messageId
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => String(message.id) === messageId)
  })
}

function turnForMessage(session: Session, messageId: string): string | undefined {
  let turn: number | undefined
  for (const event of session.events) {
    if (event.type === 'turn/start') turn = event.data.turn
    if (event.type === 'user/message' && String(event.data.id) === messageId) return turn === undefined ? undefined : String(turn)
  }
  return undefined
}
