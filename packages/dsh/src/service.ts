import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-subagent'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  deriveSurfaceId,
  EffectJournal,
  parseSurfaceDocument,
  ProjectionCompiler,
  sha256,
  SurfaceId,
  WorkSurfaceError,
  WorkSurfaceStore,
} from '@pf-worksurface/core'
import type { Revision, SurfaceIdType } from '@pf-worksurface/core'
import type { WorkSurfaceRpcRequest } from '@pf-worksurface/cli'
import { runAgent } from './agent-run.ts'
import { prepareAttempt } from './attempt.ts'
import { runAttemptGc } from './attempt-gc.ts'
import { attemptPath, authorizeRequest, childBinding, requireOrchestrator, requireSurface } from './authority.ts'
import { installB2FRootResolver } from './b2f.ts'
import { installHarnessCapabilities } from './capabilities.ts'
import { assertOutsideImplicitTemporaryRoots, assertSocketPath, CONFIG_SCHEMA, resolveConfig, validateProfiles } from './config.ts'
import type { Config } from './config.ts'
import { SESSION_ROOT_TEMPLATE } from './model/session-root-template.ts'
import { WorkSurfaceHost } from './host.ts'
import { numberParam, optionalString, stringParam } from './params.ts'
import type { AgentRunResult, AttemptAuthority, OrchestratorResult, PendingWorkspace, WorkSurfaceConfig, WorkSurfaceProfile } from './types.ts'
import { hashWorkspace, preparePendingWorkspace } from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workSurfaces: WorkSurfaceService
  }

  interface Events {
    /**
     * An Orchestrator attempt acquired its authority and is about to run.
     * @param info - The attempt identity, root Surface, script hash, and public workspace hash.
     * @mode emit
     */
    'worksurface/attempt-start'(info: {
      attemptId: string
      rootSurface: SurfaceIdType
      codeHash: string
      workspaceHash: string
    }): void
    /**
     * An Orchestrator attempt settled and its final root revision is known.
     * @param info - The persisted process outcome and replay count.
     * @mode emit
     */
    'worksurface/attempt-end'(info: OrchestratorResult): void
    /**
     * A child Agent run is starting against a pinned Surface Projection.
     * @param info - The owning attempt, assigned Surface, and profile.
     * @mode emit
     */
    'worksurface/agent-start'(info: { attemptId: string; surface: SurfaceIdType; profile: string }): void
    /**
     * A child Agent returned a validated revision-pinned completion.
     * @param info - The owning attempt, child identity, and committed completion.
     * @mode emit
     */
    'worksurface/agent-end'(info: AgentRunResult & { attemptId: string; agentId?: string }): void
  }
}

/** DeepSeek Harness WorkSurface Host and orchestration service. */
export class WorkSurfaceService extends Service {
  static inject = ['b2f', 'tools', 'systemPrompt', 'subagents', 'sandbox', 'subprocess', 'shellEnv']
  static Config = CONFIG_SCHEMA

  /** Resolved immutable service configuration. */
  readonly config: WorkSurfaceConfig
  /** Canonical file store owned by this service. */
  readonly store: WorkSurfaceStore
  /** Projection compiler bound to the canonical store. */
  readonly projections: ProjectionCompiler
  private readonly attempts = new Map<string, AttemptAuthority>()
  private readonly agentJournal: EffectJournal
  private readonly host: WorkSurfaceHost
  private readonly sessionTemplatePath: string
  private readonly initialization: Promise<void>
  private readonly sessionSurfaceInitializations = new WeakMap<Agent, Promise<SurfaceIdType>>()
  private readonly pendingWorkspaceInitializations = new Map<string, Promise<PendingWorkspace>>()
  private readonly pendingWorkspaces = new Map<string, PendingWorkspace>()
  private sessionTemplatePreparation: Promise<void> | undefined
  private harness: {
    readonly sandbox: Context['sandbox']
    readonly subagents: Context['subagents']
    readonly subprocess: Context['subprocess']
  } | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'workSurfaces')
    this.config = resolveConfig(config)
    this.store = new WorkSurfaceStore({ root: this.config.root })
    this.projections = new ProjectionCompiler(this.store)
    this.agentJournal = new EffectJournal(join(this.store.runtimeRoot, 'agent-effects'))
    this.host = new WorkSurfaceHost(this.config.socketPath, this)
    this.sessionTemplatePath = join(this.store.runtimeRoot, 'templates', 'session-root')
    validateProfiles(this.config.profiles)
    assertOutsideImplicitTemporaryRoots(this.config.root, 'WorkSurface root')
    assertOutsideImplicitTemporaryRoots(this.config.socketPath, 'WorkSurface Host socket')
    assertSocketPath(this.config.socketPath, this.config.attemptsRoot)

    const restoreB2F = installB2FRootResolver(ctx, agent => this.resolveB2FRoot(agent))
    ctx.effect(() => restoreB2F, 'worksurface.b2fRoot()')

    const lifecycle = ctx.effect(async () => {
      await this.store.init()
      await mkdir(this.config.attemptsRoot, { recursive: true, mode: 0o700 })
      await this.gcAttempts()
      await this.prepareSessionTemplate()
      await this.host.start()
      return () => this.host.close()
    }, 'worksurface.host()')
    this.initialization = Promise.resolve(lifecycle).then(() => undefined)

    this.harness = {
      sandbox: ctx.sandbox,
      subagents: ctx.subagents,
      subprocess: ctx.subprocess,
    }
    ctx.effect(() => () => {
      this.harness = undefined
    }, 'worksurface.capabilities()')
    installHarnessCapabilities({
      ctx,
      config: this.config,
      store: this.store,
      projections: this.projections,
      openSessionSurface: (agent) => this.openSessionSurface(agent),
      openSessionWorkspace: (agent, current) => this.openSessionWorkspace(agent, current),
      defaultProfile: () => this.defaultProfile(),
      runOrchestrator: (parent, language, script, rootSurfaceInput, signal) =>
        this.runOrchestrator(parent, language, script, rootSurfaceInput, signal),
      childBinding: (agentId) => childBinding(this.attempts, agentId),
      parentWorkspace: (agentId) => this.parentWorkspace(agentId),
    })
  }

  async [Service.init](): Promise<void> {
    await this.initialization
  }

  /**
   * Resolve the durable root Surface bound to one Agent session, creating its default file template once.
   * @param agent - Agent whose stable session identity owns the root Surface.
   * @returns The session root and its current revision.
   */
  async openSessionSurface(agent: Agent): Promise<{ surface: SurfaceIdType; revision: Revision }> {
    let initialization = this.sessionSurfaceInitializations.get(agent)
    if (initialization === undefined) {
      initialization = this.initializeSessionSurface(agent)
      this.sessionSurfaceInitializations.set(agent, initialization)
      void initialization.catch(() => {
        this.sessionSurfaceInitializations.delete(agent)
      })
    }
    const surface = await initialization
    return { surface, revision: (await this.store.readHead(surface)).revision }
  }

  /**
   * Prepare the parent workspace before model generation so b2f has a synchronous root.
   * @param agent - Agent that owns the pending workspace.
   * @param current - Optional already resolved session Surface pin.
   * @returns The unclaimed public workspace and prepared root checkout.
   */
  async openSessionWorkspace(
    agent: Agent,
    current?: { surface: SurfaceIdType; revision: Revision },
  ): Promise<PendingWorkspace> {
    const agentId = String(agent.id)
    const ready = this.pendingWorkspaces.get(agentId)
    if (ready !== undefined) return ready

    let initialization = this.pendingWorkspaceInitializations.get(agentId)
    if (initialization === undefined) {
      initialization = (async () => {
        const sessionRoot = current ?? await this.openSessionSurface(agent)
        const workspace = await preparePendingWorkspace(
          this.store,
          this.config.attemptsRoot,
          agent,
          sessionRoot.surface,
          sessionRoot.revision,
        )
        this.pendingWorkspaces.set(agentId, workspace)
        return workspace
      })()
      this.pendingWorkspaceInitializations.set(agentId, initialization)
    }
    try {
      return await initialization
    } finally {
      if (this.pendingWorkspaceInitializations.get(agentId) === initialization) {
        this.pendingWorkspaceInitializations.delete(agentId)
      }
    }
  }

  /**
   * Dispatch one already framed Host request after least-authority authentication.
   * @param request - The authenticated attempt identity, method, and JSON parameters.
   * @param signal - Aborts work when the client connection closes.
   * @returns The method-specific JSON-compatible result.
   */
  async dispatch(request: WorkSurfaceRpcRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new WorkSurfaceError('cancelled', 'Host request was cancelled')
    const authority = authorizeRequest(this.attempts, request)
    const params = request.params
    switch (request.method) {
      case 'new': {
        requireOrchestrator(authority)
        const templatePath = await attemptPath(authority.attempt, stringParam(params, 'templatePath'))
        const parent = optionalString(params, 'parent')
        if (parent !== undefined) requireSurface(authority, parent)
        const requestedSurface = optionalString(params, 'surface')
        const result = await this.store.newSurface({
          attemptId: request.attemptId,
          key: stringParam(params, 'key'),
          templatePath,
          ...(parent === undefined ? {} : { parent }),
          ...(requestedSurface === undefined ? {} : { surface: requestedSurface }),
          ...(params.retry === true ? { retry: true } : {}),
        })
        authority.attempt.surfaces.add(result.surface)
        return result
      }
      case 'checkout': {
        const surface = requireSurface(authority, stringParam(params, 'surface'))
        if (authority.child !== undefined) {
          throw new WorkSurfaceError('unauthorized', 'child Agents receive their checkout from the Host and cannot materialize another copy')
        }
        const targetPath = await attemptPath(authority.attempt, stringParam(params, 'targetPath'))
        return this.store.checkout({
          surface,
          targetPath,
          ...(optionalString(params, 'revision') === undefined
            ? {}
            : { revision: optionalString(params, 'revision') as Revision }),
        })
      }
      case 'commit': {
        const workingPath = await attemptPath(authority.attempt, stringParam(params, 'workingPath'))
        if (authority.child !== undefined && workingPath !== authority.child.workingPath) {
          throw new WorkSurfaceError('unauthorized', 'child Agent may commit only its assigned working copy')
        }
        const envelope = parseSurfaceDocument(await readFile(join(workingPath, 'surface.md'), 'utf8'))
        requireSurface(authority, envelope.surfaceId)
        return this.store.commit({
          attemptId: request.attemptId,
          key: stringParam(params, 'key'),
          workingPath,
          baseRevision: stringParam(params, 'baseRevision') as Revision,
          ...(params.retry === true ? { retry: true } : {}),
        })
      }
      case 'show': {
        const surface = requireSurface(authority, stringParam(params, 'surface'))
        const snapshot = await this.store.readSnapshot(surface, optionalString(params, 'revision') as Revision | undefined)
        return {
          surface: snapshot.surface,
          revision: snapshot.revision,
          surfaceDocument: snapshot.surfaceDocument,
          blocks: Object.fromEntries(snapshot.blocks),
        }
      }
      case 'projection': {
        const surface = requireSurface(authority, stringParam(params, 'surface'))
        return this.projections.compile({
          surface,
          profile: stringParam(params, 'profile'),
          tokenBudget: numberParam(params, 'tokenBudget'),
          ...(optionalString(params, 'revision') === undefined
            ? {}
            : { revision: optionalString(params, 'revision') as Revision }),
        })
      }
      case 'agent.run': {
        requireOrchestrator(authority)
        const operation = runAgent({
          ctx: this.ctx,
          store: this.store,
          projections: this.projections,
          agentJournal: this.agentJournal,
          profile: (name) => this.profile(name),
          requireHarness: () => this.requireHarness(),
        }, authority.attempt, {
          surface: requireSurface(authority, stringParam(params, 'surface')),
          task: stringParam(params, 'task'),
          profile: stringParam(params, 'profile'),
          key: stringParam(params, 'key'),
          retry: params.retry === true,
          signal,
        })
        authority.attempt.operations.add(operation)
        operation.then(
          () => authority.attempt.operations.delete(operation),
          () => authority.attempt.operations.delete(operation),
        )
        return operation
      }
    }
  }

  /**
   * Execute one sandboxed ordinary Bash or Python Orchestrator.
   * @param parent - The Agent that invoked the model-facing orchestration tool.
   * @param language - The ordinary script interpreter family.
   * @param script - The unchanged control-script source persisted for audit.
   * @param rootSurfaceInput - The attempt's pre-existing root Surface.
   * @param signal - Cancels the subprocess and its accepted child work.
   * @returns The persisted process outcome and final root revision.
   */
  async runOrchestrator(
    parent: Agent,
    language: 'bash' | 'python',
    script: string,
    rootSurfaceInput: string,
    signal: AbortSignal,
  ): Promise<OrchestratorResult> {
    if (script.trim() === '') throw new WorkSurfaceError('invalid-working-copy', 'Orchestrator script must not be blank')
    const rootSurface = SurfaceId(rootSurfaceInput)
    await this.store.readHead(rootSurface)
    const workspace = await this.openSessionWorkspace(parent)
    const workspaceHash = await hashWorkspace(workspace.workspaceRoot)
    const codeHash = sha256(`${language} ${script}`)
    const attemptId = `attempt-${sha256(`${parent.id} ${rootSurface} ${codeHash} ${workspaceHash}`).slice(0, 24)}`
    if (this.attempts.has(attemptId)) throw new WorkSurfaceError('effect-failed', `attempt '${attemptId}' is already running`)
    const authority: AttemptAuthority = {
      id: attemptId,
      token: randomBytes(32).toString('hex'),
      rootSurface,
      root: workspace.root,
      workspaceRoot: workspace.workspaceRoot,
      workspaceSurface: workspace.rootSurface,
      rootWorkingPath: workspace.rootWorkingPath,
      rootBaseRevision: workspace.rootBaseRevision,
      workspaceHash,
      parent,
      surfaces: new Set([rootSurface, workspace.rootSurface]),
      childCredentials: new Map(),
      operations: new Set(),
      activeAgents: 0,
    }
    if (this.pendingWorkspaces.get(String(parent.id)) === workspace) {
      this.pendingWorkspaces.delete(String(parent.id))
    }
    await prepareAttempt(authority, language, script, codeHash, this.config.cliEntrypoint)
    this.attempts.set(attemptId, authority)
    this.ctx.emit('worksurface/attempt-start', { attemptId, rootSurface, codeHash, workspaceHash })
    try {
      const harness = this.requireHarness()
      const command = language === 'bash' ? 'bash' : 'python3'
      const executable = await harness.subprocess.resolveExecutable(command, undefined, signal)
      const scriptPath = join(authority.root, 'control', language === 'bash' ? 'main.sh' : 'main.py')
      const confined = harness.sandbox.confine([executable, scriptPath], {
        mode: 'workspace-write',
        workspaceRoot: authority.workspaceRoot,
        sessionId: parent.id,
      })
      if (confined.enforcement !== 'full') {
        throw new WorkSurfaceError('unauthorized', 'Orchestrator requires full filesystem sandbox enforcement')
      }
      let replayCount = 0
      let outcome: { exitCode: number | null; signal: NodeJS.Signals | null }
      let stdout = ''
      let stderr = ''
      do {
        const handle = harness.subprocess.spawn({
          argv: confined.argv,
          cwd: authority.workspaceRoot,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: this.config.maxOutputBytes },
            stderr: { maxBytes: this.config.maxOutputBytes },
          },
          graceMs: this.config.orchestratorGraceMs,
          signal,
          env: {
            PATH: `${join(authority.root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
            DSH_B2F_ROOT: authority.workspaceRoot,
            WS_ROOT_SURFACE: rootSurface,
            WS_WORKING_SURFACE: authority.workspaceSurface,
            WS_WORKING_PATH: authority.rootWorkingPath,
            WS_BASE_REVISION: authority.rootBaseRevision,
            WS_HOST_SOCKET: this.config.socketPath,
            WS_ATTEMPT_ID: attemptId,
            WS_ATTEMPT_TOKEN: authority.token,
            WS_ATTEMPT_DIR: authority.workspaceRoot,
          },
        })
        outcome = await handle.done
        stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        if (outcome.signal === null || signal.aborted || replayCount >= this.config.maxCrashReplays) break
        replayCount += 1
      } while (true)
      const rootRevision = (await this.store.readHead(rootSurface)).revision
      const result: OrchestratorResult = {
        attemptId,
        rootSurface,
        codeHash,
        workspaceHash,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        stdout,
        stderr,
        replayCount,
        rootRevision,
      }
      await writeFileAtomic(join(authority.root, 'runtime', 'result.json'), `${JSON.stringify(result, null, 2)}
`, {
        mode: 0o600,
        dirMode: 0o700,
      })
      this.ctx.emit('worksurface/attempt-end', result)
      return result
    } finally {
      await Promise.allSettled([...authority.operations])
      this.attempts.delete(attemptId)
      await this.gcAttempts().catch(() => undefined)
    }
  }

  private async initializeSessionSurface(agent: Agent): Promise<SurfaceIdType> {
    const surface = sessionSurfaceId(agent)
    await this.prepareSessionTemplate()
    try {
      await this.store.newSurface({
        attemptId: `session-${sha256(String(agent.id)).slice(0, 32)}`,
        key: 'session-root',
        templatePath: this.sessionTemplatePath,
        surface,
      })
    } catch (error) {
      if ((error instanceof WorkSurfaceError) === false || error.code !== 'already-exists') throw error
      await this.store.readHead(surface)
    }
    return surface
  }

  private async prepareSessionTemplate(): Promise<void> {
    if (this.sessionTemplatePreparation !== undefined) return this.sessionTemplatePreparation
    const preparation = (async () => {
      await mkdir(join(this.sessionTemplatePath, 'blocks'), { recursive: true, mode: 0o700 })
      await writeFileAtomic(join(this.sessionTemplatePath, 'surface.md'), SESSION_ROOT_TEMPLATE, {
        mode: 0o600,
        dirMode: 0o700,
      })
    })()
    this.sessionTemplatePreparation = preparation
    try {
      await preparation
    } catch (error) {
      this.sessionTemplatePreparation = undefined
      throw error
    }
  }

  private resolveB2FRoot(agent: Agent): string | undefined {
    const child = childBinding(this.attempts, String(agent.id))
    if (child !== undefined) return child.credential.workingPath
    return this.parentWorkspace(String(agent.id))?.workspaceRoot
  }

  private parentWorkspace(agentId: string): PendingWorkspace | undefined {
    const pending = this.pendingWorkspaces.get(agentId)
    if (pending !== undefined) return pending
    for (const attempt of this.attempts.values()) {
      if (String(attempt.parent.id) !== agentId) continue
      return {
        ownerId: agentId,
        root: attempt.root,
        workspaceRoot: attempt.workspaceRoot,
        rootSurface: attempt.workspaceSurface,
        rootWorkingPath: attempt.rootWorkingPath,
        rootBaseRevision: attempt.rootBaseRevision,
      }
    }
    return undefined
  }

  private defaultProfile(): WorkSurfaceProfile {
    const profile = this.config.profiles[0]
    if (profile === undefined) throw new WorkSurfaceError('unsupported-profile', 'WorkSurface has no default profile')
    return profile
  }

  private profile(name: string): WorkSurfaceProfile {
    const profile = this.config.profiles.find(candidate => candidate.name === name)
    if (profile === undefined) throw new WorkSurfaceError('unsupported-profile', `unknown WorkSurface profile '${name}'`)
    return profile
  }

  private requireHarness(): NonNullable<WorkSurfaceService['harness']> {
    if (this.harness === undefined) {
      throw new WorkSurfaceError('effect-failed', 'WorkSurface Harness capabilities are not active')
    }
    return this.harness
  }

  private async gcAttempts(): Promise<void> {
    await runAttemptGc({
      attemptsRoot: this.config.attemptsRoot,
      attemptRetention: this.config.attemptRetention,
      activeRoots: new Set([
        ...[...this.attempts.values()].map(attempt => resolve(attempt.root)),
        ...[...this.pendingWorkspaces.values()].map(workspace => resolve(workspace.root)),
      ]),
      runtimeRoot: this.store.runtimeRoot,
    })
  }
}

function sessionSurfaceId(agent: Agent): SurfaceIdType {
  return deriveSurfaceId('session-root', String(agent.id))
}
