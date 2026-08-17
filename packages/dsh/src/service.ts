import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DshEnvironmentKey } from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-subagent'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  BlockId,
  deriveSurfaceId,
  EffectJournal,
  parseSurfaceDocument,
  ProjectionCompiler,
  sha256,
  stableStringify,
  SurfaceId,
  WorkSurfaceError,
  WorkSurfaceStore,
} from '@pf-worksurface/core'
import type { BlockRef, Revision, SurfaceIdType } from '@pf-worksurface/core'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { WorkSurfaceRpcRequest } from '@pf-worksurface/cli'
import { WorkSurfaceHost } from './host.ts'
import type {
  AgentCompletion,
  AgentRunResult,
  AttemptAuthority,
  ChildCredential,
  OrchestratorResult,
  WorkSurfaceConfig,
  WorkSurfaceProfile,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workSurfaces: WorkSurfaceService
  }

  interface Events {
    /**
     * An Orchestrator attempt acquired its authority and is about to run.
     * @param info - The attempt identity, root Surface, and immutable script hash.
     * @mode emit
     */
    'worksurface/attempt-start'(info: { attemptId: string; rootSurface: SurfaceIdType; codeHash: string }): void
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

/** User-facing plugin configuration. */
export interface Config {
  readonly root: string
  readonly attemptsRoot?: string
  readonly socketPath?: string
  readonly cliEntrypoint?: string
  readonly orchestratorGraceMs?: number
  readonly maxOutputBytes?: number
  readonly maxCrashReplays?: number
  readonly profiles: readonly WorkSurfaceProfile[]
}

const PROFILE_SCHEMA = z.object({
  name: z.string(),
  provider: z.string(),
  tokenBudget: z.number().step(1).min(1),
  maxDepth: z.number().step(1).min(0),
  maxParallel: z.number().step(1).min(1),
  toolAllow: z.array(z.string()).default(undefined as unknown as string[]),
  persona: z.string(),
  agentProvider: z.string(),
  agentModel: z.string(),
})

const AGENT_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    surface: { type: 'string' },
    surfaceRevision: { type: 'string' },
    summary: { type: 'string' },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface: { type: 'string' },
          block: { type: 'string' },
          revision: { type: 'string' },
        },
        required: ['surface', 'block', 'revision'],
      },
    },
  },
  required: ['surface', 'surfaceRevision', 'summary', 'outputs'],
}

const ORCHESTRATOR_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attemptId: { type: 'string', required: true },
      rootSurface: { type: 'string', required: true },
      codeHash: { type: 'string', required: true },
      exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      stdout: { type: 'string', required: true },
      stderr: { type: 'string', required: true },
      replayCount: { type: 'integer', required: true },
      rootRevision: { type: 'string', required: true },
    },
  } as const,
  render: (_args: unknown, value: OrchestratorResult) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const SESSION_ROOT_TEMPLATE = `# Goal

# Acceptance Criteria

# Known Facts and Constraints

# Assumptions

# Open Questions

# Current Decisions

# Deliverables and Evidence
`

const WORKSURFACE_GUIDANCE_ORDER = 150

/** DeepSeek Harness WorkSurface Host and orchestration service. */
export class WorkSurfaceService extends Service {
  static inject = ['tools', 'systemPrompt', 'subagents', 'sandbox', 'subprocess', 'shellEnv']
  static Config: z<Config> = z.object({
    root: z.string(),
    attemptsRoot: z.string(),
    socketPath: z.string(),
    cliEntrypoint: z.string(),
    orchestratorGraceMs: z.number().step(1).min(1).default(5000),
    maxOutputBytes: z.number().step(1).min(1024).default(1024 * 1024),
    maxCrashReplays: z.number().step(1).min(0).default(1),
    profiles: z.array(PROFILE_SCHEMA),
  }) as unknown as z<Config>

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

    const lifecycle = ctx.effect(async () => {
      await this.store.init()
      await mkdir(this.config.attemptsRoot, { recursive: true, mode: 0o700 })
      await this.prepareSessionTemplate()
      await this.host.start()
      return () => this.host.close()
    }, 'worksurface.host()')
    this.initialization = Promise.resolve(lifecycle).then(() => undefined)
    this.installHarnessCapabilities(ctx)
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
   * Dispatch one already framed Host request after least-authority authentication.
   * @param request - The authenticated attempt identity, method, and JSON parameters.
   * @param signal - Aborts work when the client connection closes.
   * @returns The method-specific JSON-compatible result.
   */
  async dispatch(request: WorkSurfaceRpcRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new WorkSurfaceError('cancelled', 'Host request was cancelled')
    const authority = this.authorizeRequest(request)
    const params = request.params
    switch (request.method) {
      case 'new': {
        this.requireOrchestrator(authority)
        const templatePath = await this.attemptPath(authority.attempt, stringParam(params, 'templatePath'))
        const parent = optionalString(params, 'parent')
        if (parent !== undefined) this.requireSurface(authority, parent)
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
        const surface = this.requireSurface(authority, stringParam(params, 'surface'))
        if (authority.child !== undefined) {
          throw new WorkSurfaceError('unauthorized', 'child Agents receive their checkout from the Host and cannot materialize another copy')
        }
        const targetPath = await this.attemptPath(authority.attempt, stringParam(params, 'targetPath'))
        return this.store.checkout({
          surface,
          targetPath,
          ...(optionalString(params, 'revision') === undefined
            ? {}
            : { revision: optionalString(params, 'revision') as Revision }),
        })
      }
      case 'commit': {
        const workingPath = await this.attemptPath(authority.attempt, stringParam(params, 'workingPath'))
        if (authority.child !== undefined && workingPath !== authority.child.workingPath) {
          throw new WorkSurfaceError('unauthorized', 'child Agent may commit only its assigned working copy')
        }
        const envelope = parseSurfaceDocument(await readFile(join(workingPath, 'surface.md'), 'utf8'))
        this.requireSurface(authority, envelope.surfaceId)
        return this.store.commit({
          attemptId: request.attemptId,
          key: stringParam(params, 'key'),
          workingPath,
          baseRevision: stringParam(params, 'baseRevision') as Revision,
          ...(params.retry === true ? { retry: true } : {}),
        })
      }
      case 'show': {
        const surface = this.requireSurface(authority, stringParam(params, 'surface'))
        const snapshot = await this.store.readSnapshot(surface, optionalString(params, 'revision') as Revision | undefined)
        return {
          surface: snapshot.surface,
          revision: snapshot.revision,
          surfaceDocument: snapshot.surfaceDocument,
          blocks: Object.fromEntries(snapshot.blocks),
        }
      }
      case 'projection': {
        const surface = this.requireSurface(authority, stringParam(params, 'surface'))
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
        this.requireOrchestrator(authority)
        const operation = this.runAgent(authority.attempt, {
          surface: this.requireSurface(authority, stringParam(params, 'surface')),
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
    const codeHash = sha256(`${language}\0${script}`)
    const attemptId = `attempt-${sha256(`${parent.id}\0${rootSurface}\0${codeHash}`).slice(0, 24)}`
    if (this.attempts.has(attemptId)) throw new WorkSurfaceError('effect-failed', `attempt '${attemptId}' is already running`)
    const attemptRoot = join(this.config.attemptsRoot, attemptId)
    const authority: AttemptAuthority = {
      id: attemptId,
      token: randomBytes(32).toString('hex'),
      rootSurface,
      root: attemptRoot,
      parent,
      surfaces: new Set([rootSurface]),
      childCredentials: new Map(),
      operations: new Set(),
      activeAgents: 0,
    }
    await this.prepareAttempt(authority, language, script, codeHash)
    this.attempts.set(attemptId, authority)
    this.ctx.emit('worksurface/attempt-start', { attemptId, rootSurface, codeHash })
    try {
      const harness = this.requireHarness()
      const command = language === 'bash' ? 'bash' : 'python3'
      const executable = await harness.subprocess.resolveExecutable(command, undefined, signal)
      const scriptPath = join(attemptRoot, 'control', language === 'bash' ? 'main.sh' : 'main.py')
      const confined = harness.sandbox.confine([executable, scriptPath], {
        mode: 'workspace-write',
        workspaceRoot: attemptRoot,
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
          cwd: attemptRoot,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: this.config.maxOutputBytes },
            stderr: { maxBytes: this.config.maxOutputBytes },
          },
          graceMs: this.config.orchestratorGraceMs,
          signal,
          env: {
            PATH: `${join(attemptRoot, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
            WS_ROOT_SURFACE: rootSurface,
            WS_HOST_SOCKET: this.config.socketPath,
            WS_ATTEMPT_ID: attemptId,
            WS_ATTEMPT_TOKEN: authority.token,
            WS_ATTEMPT_DIR: attemptRoot,
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
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        stdout,
        stderr,
        replayCount,
        rootRevision,
      }
      await writeFileAtomic(join(attemptRoot, 'runtime', 'result.json'), `${JSON.stringify(result, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
      this.ctx.emit('worksurface/attempt-end', result)
      return result
    } finally {
      await Promise.allSettled([...authority.operations])
      this.attempts.delete(attemptId)
    }
  }

  private installHarnessCapabilities(ctx: Context): void {
    const harness = {
      sandbox: ctx.sandbox,
      subagents: ctx.subagents,
      subprocess: ctx.subprocess,
    }
    this.harness = harness
    ctx.effect(() => () => {
      this.harness = undefined
    }, 'worksurface.capabilities()')
    ctx.systemPrompt.section({
      name: 'worksurface:guidance',
      order: WORKSURFACE_GUIDANCE_ORDER,
      text: context => context.agent === undefined ? '' : worksurfaceGuidance(),
    })
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const transformed = await next()
      if (context.agent === undefined) return transformed
      context.signal?.throwIfAborted()
      const current = await this.openSessionSurface(context.agent)
      const profile = this.defaultProfile()
      const projection = await this.projections.compile({
        surface: current.surface,
        profile: profile.name,
        tokenBudget: profile.tokenBudget,
        revision: current.revision,
      })
      context.signal?.throwIfAborted()
      transformed.contexts.push({
        name: 'worksurface:projection',
        text: renderSessionProjection(current.surface, projection.surfaceRevision, projection.renderedContent),
      })
      return transformed
    })
    ctx.tools.register(defineTool({
      name: 'run_orchestrator',
      description: 'Run an ordinary Bash or Python control script against PF WorkSurface state. Use it for complex, multi-stage work that needs durable decisions, resumption, review, evidence, or independently delegated deliverables; skip simple questions and bounded one-step changes.',
      parameters: {
        language: { type: 'string', required: true, enum: ['bash', 'python'], description: 'Ordinary script language.' },
        script: { type: 'string', required: true, description: 'Control script; ws is on PATH, WS_ROOT_SURFACE names the authorized root, ws --help lists commands, and ws help init supplies authoring guidance.' },
        rootSurface: { type: 'string', description: 'Authorized root Surface; omit it or pass an empty value to use the calling Agent session root.' },
      },
      output: ORCHESTRATOR_OUTPUT,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new WorkSurfaceError('unauthorized', 'run_orchestrator requires a calling Agent')
        const rootSurface = args.rootSurface === undefined || args.rootSurface.trim() === ''
          ? (await this.openSessionSurface(exec.agent)).surface
          : args.rootSurface
        return this.runOrchestrator(exec.agent, args.language, args.script, rootSurface, exec.signal)
      },
    }))
    ctx.tools.guard((exec) => {
      if (exec.name === 'run_orchestrator') return undefined
      return jsonContainsPath(exec.arguments, this.store.canonicalRoot)
        ? 'WorkSurface canonical state is Host-only; use the ws CLI'
        : undefined
    })
    const variables = {
      DSH_WS_HOST_SOCKET: { description: 'Private WorkSurface Host socket for this child Agent.' },
      DSH_WS_ATTEMPT_ID: { description: 'Current WorkSurface attempt identity.' },
      DSH_WS_ATTEMPT_TOKEN: { description: 'Least-authority credential for this child Agent.' },
      DSH_WS_ATTEMPT_DIR: { description: 'Current WorkSurface attempt directory.' },
      DSH_WS_WORKING_PATH: { description: 'Assigned editable checkout for this child Agent.' },
      DSH_WS_SURFACE: { description: 'Assigned WorkSurface identity for this child Agent.' },
    } as const
    ctx.shellEnv.register({
      name: 'worksurface',
      variables,
      resolve: (exec) => {
        if (exec.agent === undefined) return {}
        const binding = this.childBinding(exec.agent.id)
        if (binding === undefined) return {}
        const { attempt, credential } = binding
        return {
          DSH_WS_HOST_SOCKET: this.config.socketPath,
          DSH_WS_ATTEMPT_ID: credential.attemptId,
          DSH_WS_ATTEMPT_TOKEN: credential.token,
          DSH_WS_ATTEMPT_DIR: attempt.root,
          DSH_WS_WORKING_PATH: credential.workingPath,
          DSH_WS_SURFACE: credential.surface,
        } satisfies Partial<Record<DshEnvironmentKey, string>>
      },
    })
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
      if (!(error instanceof WorkSurfaceError) || error.code !== 'already-exists') throw error
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

  private defaultProfile(): WorkSurfaceProfile {
    const profile = this.config.profiles[0]
    if (profile === undefined) throw new WorkSurfaceError('unsupported-profile', 'WorkSurface has no default profile')
    return profile
  }

  private async runAgent(
    attempt: AttemptAuthority,
    request: {
      readonly surface: SurfaceIdType
      readonly task: string
      readonly profile: string
      readonly key: string
      readonly retry: boolean
      readonly signal: AbortSignal
    },
  ): Promise<AgentRunResult> {
    const profile = this.profile(request.profile)
    const keyComponent = safeKey(request.key)
    const head = await this.store.readHead(request.surface)
    const journalRequest = {
      surface: request.surface,
      task: request.task,
      profile: profile.name,
    }
    return this.agentJournal.run({
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
        const runRoot = join(attempt.root, 'runtime', 'agents', keyComponent)
        const workingPath = join(attempt.root, 'work', `${request.surface}-${keyComponent}`)
        const projection = await this.projections.compile({
          surface: request.surface,
          profile: profile.name,
          tokenBudget: profile.tokenBudget,
          revision: head.revision,
        })
        await mkdir(runRoot, { recursive: true, mode: 0o700 })
        await writeFileAtomic(join(runRoot, 'projection.json'), `${JSON.stringify(projection, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
        await rm(workingPath, { recursive: true, force: true })
        await this.store.checkout({ surface: request.surface, targetPath: workingPath, revision: head.revision })
        const childToken = randomBytes(32).toString('hex')
        let childId: string | undefined
        try {
          this.ctx.emit('worksurface/agent-start', { attemptId: attempt.id, surface: request.surface, profile: profile.name })
          const run = await this.requireHarness().subagents.start(profile.provider, {
            label: `WorkSurface ${request.surface}`,
            prompt: [{ type: 'text', text: request.task }],
            parent: attempt.parent,
            signal: request.signal,
            outputSchema: AGENT_OUTPUT_SCHEMA,
            maxDepth: profile.maxDepth,
            ...(profile.toolAllow === undefined ? {} : { toolFilter: { allow: profile.toolAllow } }),
            persona: childPersona(profile, request.surface, projection.renderedContent, projection.surfaceRevision, workingPath),
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
          const credential: ChildCredential = {
            attemptId: attempt.id,
            token: childToken,
            surface: request.surface,
            workingPath,
          }
          attempt.childCredentials.set(run.id, credential)
          let settled: Awaited<typeof run.result>
          try {
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
          const current = await this.store.readHead(request.surface)
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
          await this.store.validateOutputRefs(completion.outputs)
          await writeFileAtomic(join(runRoot, 'result.json'), `${JSON.stringify(completion, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
          await writeFileAtomic(join(runRoot, 'binding.json'), `${JSON.stringify({ agentId: childId, surface: request.surface }, null, 2)}\n`, {
            mode: 0o600,
            dirMode: 0o700,
          })
          this.ctx.emit('worksurface/agent-end', { attemptId: attempt.id, agentId: childId, ...completion })
          return completion
        } finally {
          attempt.activeAgents -= 1
          if (childId !== undefined) attempt.childCredentials.delete(childId)
        }
      },
    })
  }

  private authorizeRequest(request: WorkSurfaceRpcRequest): { attempt: AttemptAuthority; child?: ChildCredential } {
    const attempt = this.attempts.get(request.attemptId)
    if (attempt === undefined) throw new WorkSurfaceError('unauthorized', `attempt '${request.attemptId}' is not active`)
    if (timingSafeTextEqual(attempt.token, request.token)) return { attempt }
    for (const child of attempt.childCredentials.values()) {
      if (timingSafeTextEqual(child.token, request.token)) return { attempt, child }
    }
    throw new WorkSurfaceError('unauthorized', 'invalid WorkSurface attempt token')
  }

  private requireOrchestrator(authority: { child?: ChildCredential }): void {
    if (authority.child !== undefined) throw new WorkSurfaceError('unauthorized', 'operation requires Orchestrator authority')
  }

  private requireSurface(authority: { attempt: AttemptAuthority; child?: ChildCredential }, surfaceInput: string): SurfaceIdType {
    const surface = SurfaceId(surfaceInput)
    if (authority.child !== undefined) {
      if (surface !== authority.child.surface) throw new WorkSurfaceError('unauthorized', `child Agent cannot access Surface '${surface}'`)
      return surface
    }
    if (!authority.attempt.surfaces.has(surface)) {
      throw new WorkSurfaceError('unauthorized', `attempt cannot access Surface '${surface}'`)
    }
    return surface
  }

  private profile(name: string): WorkSurfaceProfile {
    const profile = this.config.profiles.find(candidate => candidate.name === name)
    if (profile === undefined) throw new WorkSurfaceError('unsupported-profile', `unknown WorkSurface profile '${name}'`)
    return profile
  }

  private childBinding(agentId: string): { attempt: AttemptAuthority; credential: ChildCredential } | undefined {
    for (const attempt of this.attempts.values()) {
      const credential = attempt.childCredentials.get(agentId)
      if (credential !== undefined) return { attempt, credential }
    }
    return undefined
  }

  private requireHarness(): NonNullable<WorkSurfaceService['harness']> {
    if (this.harness === undefined) {
      throw new WorkSurfaceError('effect-failed', 'WorkSurface Harness capabilities are not active')
    }
    return this.harness
  }

  private async attemptPath(attempt: AttemptAuthority, input: string): Promise<string> {
    const target = resolve(attempt.root, input)
    const rel = relative(attempt.root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new WorkSurfaceError('unauthorized', `path escapes attempt directory: ${input}`)
    }
    let cursor = attempt.root
    for (const component of rel.split(sep).filter(Boolean)) {
      cursor = join(cursor, component)
      try {
        if ((await lstat(cursor)).isSymbolicLink()) {
          throw new WorkSurfaceError('unauthorized', `symbolic links are forbidden at the Host boundary: ${cursor}`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
        throw error
      }
    }
    return target
  }

  private async prepareAttempt(
    attempt: AttemptAuthority,
    language: 'bash' | 'python',
    script: string,
    codeHash: string,
  ): Promise<void> {
    await mkdir(join(attempt.root, 'control'), { recursive: true, mode: 0o700 })
    await mkdir(join(attempt.root, 'work'), { recursive: true, mode: 0o700 })
    await mkdir(join(attempt.root, 'results'), { recursive: true, mode: 0o700 })
    await mkdir(join(attempt.root, 'runtime'), { recursive: true, mode: 0o700 })
    await mkdir(join(attempt.root, 'bin'), { recursive: true, mode: 0o700 })
    const scriptPath = join(attempt.root, 'control', language === 'bash' ? 'main.sh' : 'main.py')
    await writeFileAtomic(scriptPath, script, { mode: 0o700, dirMode: 0o700 })
    await writeFileAtomic(join(attempt.root, 'control', 'code-hash'), `${codeHash}\n`, { mode: 0o600, dirMode: 0o700 })
    const wrapper = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(this.config.cliEntrypoint)} "$@"\n`
    const wsPath = join(attempt.root, 'bin', 'ws')
    await writeFile(wsPath, wrapper, { mode: 0o700 })
    await chmod(wsPath, 0o700)
  }
}

/**
 * Resolve the installed CLI export without assuming a monorepo directory layout.
 * @returns The absolute installed CLI entrypoint.
 */
export function resolveWorkSurfaceCliEntrypoint(): string {
  return createRequire(import.meta.url).resolve('@pf-worksurface/cli/bin')
}

function sessionSurfaceId(agent: Agent): SurfaceIdType {
  return deriveSurfaceId('session-root', String(agent.id))
}

function worksurfaceGuidance(): string {
  return 'PF WorkSurface is active. It externalizes verifiable task state, not hidden reasoning, for complex, multi-stage work. '
    + 'Use it proactively without waiting for the user to name it when work needs durable decisions, competing alternatives, delegation, later resumption, review, or evidence-backed delivery. '
    + 'Skip it for simple questions and bounded one-step changes whose existing files already contain the complete durable result. '
    + 'Before delegating, initialize the root with the goal, known facts, assumptions, constraints, acceptance criteria, open questions, current decisions, and expected deliverables. '
    + 'Keep accepted state and supporting evidence current, and mark superseded content explicitly. Create child Surfaces only for independently owned deliverables. '
    + 'Call run_orchestrator with an ordinary Bash or Python script; in Code Mode call tools.run_orchestrator from run_code. '
    + 'Use ws --help for commands and ws help init for authoring guidance. '
    + 'Canonical files are Host-only, and child results count only when they name committed Block revisions.'
}

function renderSessionProjection(surface: SurfaceIdType, revision: Revision, content: string): string {
  return `PF WorkSurface Projection\nRoot Surface: ${surface}\nRevision: ${revision}\n\n${content}`
}

function resolveConfig(config: Config): WorkSurfaceConfig {
  if (config.root.trim() === '') throw new TypeError('WorkSurface root must not be blank')
  const root = resolve(config.root)
  return {
    root,
    attemptsRoot: resolve(config.attemptsRoot ?? join(root, 'attempts')),
    socketPath: resolve(config.socketPath ?? defaultSocketPath(root)),
    cliEntrypoint: config.cliEntrypoint === undefined
      ? resolveWorkSurfaceCliEntrypoint()
      : resolve(config.cliEntrypoint),
    orchestratorGraceMs: positiveInteger(config.orchestratorGraceMs ?? 5000, 'orchestratorGraceMs'),
    maxOutputBytes: positiveInteger(config.maxOutputBytes ?? 1024 * 1024, 'maxOutputBytes'),
    maxCrashReplays: nonNegativeInteger(config.maxCrashReplays ?? 1, 'maxCrashReplays'),
    profiles: config.profiles,
  }
}

function defaultSocketPath(root: string): string {
  return join(homedir(), '.pf-worksurface', 'run', `${sha256(root).slice(0, 16)}.sock`)
}

function validateProfiles(profiles: readonly WorkSurfaceProfile[]): void {
  if (profiles.length === 0) throw new TypeError('at least one WorkSurface profile is required')
  const names = new Set<string>()
  for (const profile of profiles) {
    if (profile.name.trim() === '' || profile.provider.trim() === '') throw new TypeError('profile name and provider must not be blank')
    if (names.has(profile.name)) throw new TypeError(`duplicate WorkSurface profile '${profile.name}'`)
    names.add(profile.name)
    positiveInteger(profile.tokenBudget, `${profile.name}.tokenBudget`)
    nonNegativeInteger(profile.maxDepth, `${profile.name}.maxDepth`)
    positiveInteger(profile.maxParallel, `${profile.name}.maxParallel`)
  }
}

function assertOutsideImplicitTemporaryRoots(path: string, label: string): void {
  const targets = new Set([resolve(path), canonicalPath(path)])
  const temporaryRoots = new Set(['/tmp', tmpdir()].flatMap(root => [resolve(root), canonicalPath(root)]))
  for (const target of targets) {
    for (const temporaryRoot of temporaryRoots) {
      const rel = relative(temporaryRoot, target)
      if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) continue
      throw new TypeError(
        `${label} '${target}' is inside sandbox-writable temporary root '${temporaryRoot}'; `
        + 'use a persistent non-temporary directory',
      )
    }
  }
}

function assertSocketPath(socketPath: string, attemptsRoot: string): void {
  if (process.platform !== 'win32' && Buffer.byteLength(socketPath) > 100) {
    throw new TypeError(`WorkSurface Host socket path exceeds the portable Unix limit: ${socketPath}`)
  }
  const rel = relative(resolve(attemptsRoot), resolve(socketPath))
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    throw new TypeError('WorkSurface Host socket must be outside the Orchestrator attempts directory')
  }
}

function childPersona(
  profile: WorkSurfaceProfile,
  surface: SurfaceIdType,
  projection: string,
  baseRevision: Revision,
  workingPath: string,
): string {
  return `${profile.persona === undefined ? '' : `${profile.persona}\n\n`}Assigned WorkSurface: ${surface}\n\nCurrent WorkSurface Projection:\n\n${projection}\n\n`
    + `Your only editable WorkSurface checkout is ${workingPath}. Its required commit base revision is ${baseRevision}. `
    + 'Use the ws CLI to commit it with that exact --base revision and a stable --key. '
    + 'Return only the required structured completion: surface, surfaceRevision, summary, and non-empty outputs. '
    + 'Every output must name a committed Block in your assigned Surface at its exact revision.'
}

function parseAgentCompletion(value: unknown): AgentCompletion {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkSurfaceError('invalid-reference', 'child Agent did not return the structured completion object')
  }
  const record = value as Record<string, unknown>
  const surface = stringValue(record.surface, 'surface')
  const surfaceRevision = revisionValue(record.surfaceRevision, 'surfaceRevision')
  const summary = stringValue(record.summary, 'summary')
  if (!Array.isArray(record.outputs) || record.outputs.length === 0) {
    throw new WorkSurfaceError('invalid-reference', 'child Agent outputs must be a non-empty array')
  }
  const outputs = record.outputs.map((item, index): BlockRef => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new WorkSurfaceError('invalid-reference', `child output ${index} must be an object`)
    }
    const output = item as Record<string, unknown>
    return {
      surface: SurfaceId(stringValue(output.surface, `outputs[${index}].surface`)),
      block: BlockId(stringValue(output.block, `outputs[${index}].block`)),
      revision: revisionValue(output.revision, `outputs[${index}].revision`),
    }
  })
  return { surface, surfaceRevision, summary, outputs }
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string): string {
  return stringValue(params[name], name)
}

function optionalString(params: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = params[name]
  return value === undefined ? undefined : stringValue(value, name)
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new WorkSurfaceError('invalid-working-copy', `${name} must be a non-empty string`)
  return value
}

function revisionValue(value: unknown, name: string): Revision {
  const revision = stringValue(value, name)
  if (!/^sha256:[0-9a-f]{64}$/.test(revision)) throw new WorkSurfaceError('invalid-reference', `${name} must be a sha256 revision`)
  return revision as Revision
}

function numberParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const value = params[name]
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new WorkSurfaceError('invalid-working-copy', `${name} must be a positive integer`)
  return value as number
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`)
  return value
}

function safeKey(key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) throw new WorkSurfaceError('invalid-id', 'effect key is not filesystem-safe')
  return key
}

function jsonContainsPath(value: unknown, canonicalRoot: string): boolean {
  try {
    return stableStringify(value).includes(canonicalRoot)
  } catch {
    return false
  }
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftHash = sha256(left)
  const rightHash = sha256(right)
  let mismatch = 0
  for (let index = 0; index < leftHash.length; index += 1) mismatch |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index)
  return mismatch === 0
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function readJsonOptional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
