import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import type SessionStore from '@deepseek-ai/dsh-session'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkSurfaceError } from '@pf-worksurface/core'
import type { BashEnvContributor, ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import { workSurfaceInstructions } from './model/session-instructions.ts'
import type { SurfaceSessionService } from './session-surface.ts'

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
  private readonly cliPath = fileURLToPath(import.meta.resolve('@pf-worksurface/cli/bin'))

  constructor(
    private readonly ctx: Context,
    private readonly service: SurfaceSessionService,
    private readonly socketPath: string,
    private readonly ensureSurface?: (surfaceId: string) => Promise<{ readonly sessionId: string }>,
  ) {
    this.registerSessionEvents()
    this.registerShellContext()
    this.registerModelContext()
    this.adoptLiveAgents()
    const unregister = this.service.registerFollowupRouter((surfaceId, message, messageId) => this.deliverFollowup(surfaceId, message, messageId))
    this.ctx.effect(() => unregister, 'worksurface.sessionFollowupRouter()')
  }

  private async deliverFollowup(surfaceId: string, message: string, messageId: string): Promise<{ readonly sessionId: string; readonly messageId: string }> {
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
    if (hasMessageReceipt(agent.session, messageId)) return { sessionId: binding.sessionId, messageId }

    agent.followup(freezeMessage({
      id: MessageId(messageId),
      role: 'user' as const,
      content: [{ type: 'text' as const, text: message }],
      source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh' },
    }))
    const durable = await this.ctx.sessions.flush(agent.session)
    if (!durable || !hasMessageReceipt(agent.session, messageId)) {
      throw new WorkSurfaceError('effect-failed', `DSH Session '${binding.sessionId}' did not durably accept followup '${messageId}'`)
    }
    return { sessionId: binding.sessionId, messageId }
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
    this.ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') this.service.beginTurn(session, event.data.turn)
      if (event.type === 'turn/end') this.service.endTurn(String(session.id), event.data.turn)
    })
    this.ctx.on('session/disposed', session => { this.service.endTurn(String(session.id)) })
  }

  private registerModelContext(): void {
    this.ctx.on('agent/session-start', ({ agent }) => {
      const binding = this.service.attachSession(agent.session)
      if (binding !== undefined) agent.inject(workSurfaceInstructions(binding.surfaceId))
    })
  }

  private registerShellContext(): void {
    const contributor: BashEnvContributor = {
      name: 'worksurface-session-v1',
      variables: {
        DSH_WORKSURFACE_CLI: { description: 'Absolute WorkSurface CLI path for the current DSH Turn.' },
        DSH_WORKSURFACE_SOCKET: { description: 'Private Host transport selected by the WorkSurface plugin.' },
        DSH_WORKSURFACE_CAPABILITY: { description: 'Short-lived capability bound to the current DSH Session and Turn.' },
        DSH_SURFACE_ID: { description: 'The one WorkSurface whose progress this DSH Session records.' },
        DSH_SURFACE_DIR: { description: 'Persistent worktree and cwd of this Surface Session.' },
        DSH_CONTEXT_FILE: { description: 'Structured context for this Surface Session.' },
      },
      resolve: execution => {
        if (execution.agent === undefined) return {}
        const sessionId = String(execution.agent.id)
        const turn = this.service.activeTurn(sessionId)
        if (turn === undefined) return {}
        const surface = this.service.activeSurface(sessionId)
        if (surface === undefined) return {}
        return {
          DSH_WORKSURFACE_CLI: this.cliPath,
          DSH_WORKSURFACE_SOCKET: this.socketPath,
          DSH_WORKSURFACE_CAPABILITY: turn.capability,
          DSH_SURFACE_ID: surface.surfaceId,
          DSH_SURFACE_DIR: surface.cwd,
          DSH_CONTEXT_FILE: surface.contextFile,
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
  socketPath: string,
  ensureSurface?: (surfaceId: string) => Promise<{ readonly sessionId: string }>,
): DshWorkSurfaceSessionAdapter {
  return new DshWorkSurfaceSessionAdapter(ctx, service, socketPath, ensureSurface)
}

function hasMessageReceipt(session: Session, messageId: string): boolean {
  return session.events.some(event => {
    if (event.type === 'user/message') return String(event.data.id) === messageId
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => String(message.id) === messageId)
  })
}
