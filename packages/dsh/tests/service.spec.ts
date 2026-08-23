import { spawn as spawnChild } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  ContinuableStartSpec,
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { WorkSurfaceHostClient } from '@pf-worksurface/cli'
import { sha256, stableStringify, WorkSurfaceError, WorkSurfaceStore } from '@pf-worksurface/core'
import WorkSurfaceService, { resolveWorkSurfaceCliEntrypoint } from '../src/index.ts'
import type {
  B2FPublicationReceipt,
  B2FPublicationRequest,
  B2FPublisher,
  B2FRootResolution,
  B2FRootScope,
  B2FServiceContract,
} from '../src/b2f.ts'
import type { Config, WorkSurfaceProfile } from '../src/index.ts'

interface ScriptOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

class FixtureB2FService extends Service implements B2FServiceContract {
  private readonly fallback: (agent?: Agent, session?: unknown) => string
  private readonly resolvers: Array<{
    resolve: (agent?: Agent, session?: unknown, paths?: readonly string[]) => B2FRootResolution | Promise<B2FRootResolution>
  }> = []
  private readonly publishers: B2FPublisher[] = []

  constructor(ctx: Context, config: { root: string }) {
    super(ctx, 'b2f')
    this.fallback = () => config.root
  }

  registerRootResolver(
    resolver: (agent?: Agent, session?: unknown, paths?: readonly string[]) => B2FRootResolution | Promise<B2FRootResolution>,
  ): () => void {
    const entry = { resolve: resolver }
    this.resolvers.push(entry)
    return () => {
      const index = this.resolvers.lastIndexOf(entry)
      if (index >= 0) this.resolvers.splice(index, 1)
    }
  }

  registerPublisher(publisher: B2FPublisher): () => void {
    this.publishers.push(publisher)
    return () => {
      const index = this.publishers.lastIndexOf(publisher)
      if (index >= 0) this.publishers.splice(index, 1)
    }
  }

  async publish(request: B2FPublicationRequest): Promise<B2FPublicationReceipt | undefined> {
    for (let index = this.publishers.length - 1; index >= 0; index -= 1) {
      const receipt = await this.publishers[index]?.(request)
      if (receipt !== undefined) return receipt
    }
    return undefined
  }

  setRootResolver(resolver: (agent?: Agent, session?: unknown) => string): () => void {
    return this.registerRootResolver(resolver)
  }

  resolveRoot(agent?: Agent, session?: unknown, paths?: readonly string[]): string {
    for (let index = this.resolvers.length - 1; index >= 0; index -= 1) {
      const selected = this.resolvers[index]?.resolve(agent, session, paths)
      if (selected !== undefined && typeof (selected as Promise<B2FRootResolution>).then === 'function') {
        throw new Error('fixture root requires asynchronous resolution')
      }
      if (typeof selected === 'string') return selected
      if (selected !== undefined) return selected.root
    }
    return this.fallback(agent, session)
  }

  async resolveScope(agent?: Agent, session?: unknown, paths?: readonly string[]): Promise<B2FRootScope> {
    for (let index = this.resolvers.length - 1; index >= 0; index -= 1) {
      const selected = await this.resolvers[index]?.resolve(agent, session, paths)
      if (typeof selected === 'string') return { root: selected, scope: `root:${selected}` }
      if (selected !== undefined) return selected
    }
    return { root: this.fallback(agent, session), scope: 'workspace' }
  }
}


class PassthroughSandbox extends SandboxProvider {
  static enforcement: ConfinedArgv['enforcement'] = 'full'
  static policies: SandboxPolicy[] = []

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    PassthroughSandbox.policies.push(policy)
    return { argv: [...argv], enforcement: PassthroughSandbox.enforcement, denialSignatures: [], runnerFailureRules: [] }
  }
}

class ScriptedSubprocess extends SubprocessRuntime {
  static omitCollected = false
  static executableResolver: (command: string) => Promise<string> = async command => `/fixture/${command}`
  static runner: (spec: SubprocessSpawnSpec) => Promise<ScriptOutcome> = async () => ({
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
  })

  async resolveExecutable(command: string): Promise<string> {
    return ScriptedSubprocess.executableResolver(command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    let outcome: ScriptOutcome | undefined
    const done = ScriptedSubprocess.runner(spec).then((value) => {
      outcome = value
      return { exitCode: value.exitCode, signal: value.signal }
    })
    const reader = (stream: 'stdout' | 'stderr') => ({
      readFrom: (_offset: number) => {
        const text = outcome?.[stream] ?? ''
        return { text, nextOffset: Buffer.byteLength(text), lossy: false }
      },
    })
    return {
      pid: 100,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: ScriptedSubprocess.omitCollected ? {} : { stdout: reader('stdout'), stderr: reader('stderr') },
      done,
      terminate() {},
      async waitForExit() { await done; return true },
    }
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('not used by WorkSurface')
  }
}

class EditingProvider implements SubagentProvider {
  readonly name = 'fixture-provider'
  readonly capabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = false
  starts = 0
  disposals = 0
  personas: string[] = []
  b2fRoots: string[] = []
  requests: ResolvedSubagentStartRequest[] = []
  isolationFailures: string[] = []
  authorityFailures: string[] = []
  private quiescenceRelease: (() => void) | undefined
  private quiescenceReadyResolve: () => void = () => {}
  readonly quiescenceReady = new Promise<void>((resolve) => { this.quiescenceReadyResolve = resolve })

  constructor(private readonly ctx: Context) {}

  releaseQuiescence(): void {
    this.quiescenceRelease?.()
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.starts += 1
    this.requests.push(request)
    this.personas.push(request.persona ?? '')
    const child = {
      id: `child-${this.starts}`,
      session: {
        header: {
          version: 0,
          id: `child-${this.starts}`,
          createdAt: 0,
          origin: 'subagent',
          delegationDepth: 1,
        },
      },
    } as unknown as Agent
    const task = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
    if (task === 'start-failed') throw new Error('provider start failed')
    if (task === 'remote-provider') {
      return {
        id: child.id,
        localAgent: undefined,
        result: Promise.resolve({ output: [], structured: undefined, stopReason: 'completed' }),
        dispose: async () => { this.disposals += 1 },
      }
    }
    return {
      id: child.id,
      localAgent: child,
      result: this.complete(child, request.persona ?? '', task),
      dispose: async () => { this.disposals += 1 },
    }
  }

  async complete(child: Agent, persona: string, task: string): Promise<SubagentResult> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (task.includes('quiescence')) {
      this.quiescenceReadyResolve()
      await new Promise<void>((resolve) => { this.quiescenceRelease = resolve })
    }
    const env = this.ctx.shellEnv.collect({ agent: child } as ToolExecution)
    const b2fRoot = b2fService(this.ctx).resolveRoot(child)
    this.b2fRoots.push(b2fRoot)
    if (b2fRoot !== requiredEnv(env.DSH_WS_WORKING_PATH)) throw new Error('child b2f root does not match its checkout')
    const client = new WorkSurfaceHostClient({
      socketPath: requiredEnv(env.DSH_WS_HOST_SOCKET),
      attemptId: requiredEnv(env.DSH_WS_ATTEMPT_ID),
      token: requiredEnv(env.DSH_WS_ATTEMPT_TOKEN),
    })
    const surface = requiredEnv(env.DSH_WS_SURFACE)
    const base = /base revision is (sha256:[0-9a-f]{64})/.exec(persona)?.[1]
    if (base === undefined) throw new Error('persona omitted the commit base revision')

    if (task === 'stopped') {
      return { output: [], structured: undefined, stopReason: 'aborted' }
    }
    const invalidStructured = invalidStructuredCompletion(task, surface, base)
    if (invalidStructured.matched) {
      return { output: [], structured: invalidStructured.value, stopReason: 'completed' as const }
    }

    if (task.includes('isolation')) {
      try {
        await client.call('show', { surface: 'ws-root' })
      } catch (error) {
        this.isolationFailures.push((error as { code?: string }).code ?? 'unknown')
      }
    }

    if (task === 'authority-errors') {
      const workingPath = requiredEnv(env.DSH_WS_WORKING_PATH)
      const badToken = new WorkSurfaceHostClient({
        socketPath: requiredEnv(env.DSH_WS_HOST_SOCKET),
        attemptId: requiredEnv(env.DSH_WS_ATTEMPT_ID),
        token: 'invalid-token',
      })
      for (const operation of [
        () => client.call('projection', { surface: 'ws-root', profile: 'test', tokenBudget: 100 }),
        () => client.call('checkout', { surface, targetPath: join(workingPath, 'other') }),
        () => client.call('agent.run', { surface, task: 'nested', profile: 'test', key: 'nested' }),
        () => client.call('show', { surface: 'ws-other' }),
        () => client.call('commit', { workingPath: join(workingPath, '..', 'other'), baseRevision: base, key: 'other' }),
        () => badToken.call('show', { surface }),
      ]) {
        try {
          await operation()
          this.authorityFailures.push('unexpected-success')
        } catch (error) {
          this.authorityFailures.push((error as { code?: string }).code ?? 'unknown')
        }
      }
    }

    if (task.includes('uncommitted')) {
      return {
        output: [{ type: 'text' as const, text: 'FABRICATED FINAL TEXT' }],
        structured: {
          surface,
          surfaceRevision: base,
          summary: 'pretended success',
          outputs: [{ surface, block: 'result', revision: base }],
        },
        stopReason: 'completed' as const,
      }
    }

    const workingPath = requiredEnv(env.DSH_WS_WORKING_PATH)
    const blockPath = join(workingPath, 'blocks', 'result.md')
    const original = await readFile(blockPath, 'utf8')
    await writeFile(blockPath, `${original}\nCommitted task: ${task}\n`)
    const commit = task === 'foreign-commit'
      ? await this.ctx.workSurfaces.store.commit({
        attemptId: 'foreign-orchestrator-attempt',
        key: 'foreign-commit',
        workingPath,
        baseRevision: base as never,
      })
      : await client.call('commit', {
        workingPath,
        baseRevision: base,
        key: `child-commit-${task.replaceAll(/[^A-Za-z0-9]+/g, '-').slice(0, 64)}`,
      }) as { revision: string }
    return {
      output: [{ type: 'text' as const, text: 'FABRICATED FINAL TEXT' }],
      structured: {
        surface: task === 'different-surface' ? 'ws-other' : surface,
        surfaceRevision: task === 'wrong-surface-revision' ? base : commit.revision,
        summary: `completed ${task}`,
        outputs: [{
          surface: task === 'different-output-surface' ? 'ws-other' : surface,
          block: task.includes('missing') ? 'does-not-exist' : 'result',
          revision: task === 'wrong-output-revision' || task === 'wrong-revision' ? base : commit.revision,
        }],
      },
      stopReason: 'completed' as const,
    }
  }
}

class FixtureContinuationDriver {
  private service: WorkSurfaceService | undefined
  private nextId = 0

  constructor(private readonly ctx: Context, private readonly provider: EditingProvider) {}

  install(): void {
    const runtime = this.ctx.subagents as unknown as {
      startContinuable(spec: ContinuableStartSpec): Promise<{ childId: string; messageId: string }>
      followup(parent: Agent, childId: string, content: unknown[], options: { signal: AbortSignal }): Promise<string>
    }
    runtime.startContinuable = spec => this.start(spec)
    runtime.followup = (parent, childId, _content, options) => this.followup(parent, childId, options.signal)
  }

  attach(service: WorkSurfaceService): void {
    this.service = service
  }

  private async start(spec: ContinuableStartSpec): Promise<{ childId: string; messageId: string }> {
    const task = spec.request.prompt[0]?.type === 'text' ? spec.request.prompt[0].text : ''
    this.provider.starts += 1
    this.provider.personas.push(spec.request.persona ?? '')
    this.provider.requests.push(spec.request as unknown as ResolvedSubagentStartRequest)
    if (task === 'start-failed') throw new Error('provider start failed')
    if (task === 'remote-provider') throw new WorkSurfaceError('unsupported-profile', 'fixture rejects a non-local continuation provider')
    const childId = `child-${++this.nextId}`
    const child = fixtureChild(childId, String(spec.request.parent.id))
    const activation = this.installActivation(child)
    this.emitStart(childId)
    queueMicrotask(() => { void this.runActivation(child, task, spec.request.persona ?? '', activation) })
    return { childId, messageId: `message-${childId}` }
  }

  private async followup(parent: Agent, childId: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const service = this.requiredService()
    const binding = await service.store.readSessionBinding({ sessionId: childId })
    if (binding?.input?.task === undefined) throw new Error(`missing durable fixture task for ${childId}`)
    const child = fixtureChild(childId, String(parent.id))
    const activation = this.installActivation(child)
    this.emitStart(childId)
    queueMicrotask(() => { void this.runActivation(child, binding.input?.task ?? '', '', activation) })
    return `followup-${childId}`
  }

  private async runActivation(
    child: Agent,
    task: string,
    persona: string,
    activation: { ready: Promise<string>; dispose(): void },
  ): Promise<void> {
    try {
      const projectionText = await activation.ready
      const result = await this.provider.complete(child, persona || projectionText, task)
      this.ctx.emit('subagent/end', {
        runId: `run-${child.id}` as never,
        provider: this.provider.name,
        id: child.id,
        local: true,
        stopReason: result.stopReason,
        ...(result.structured === undefined ? {} : {
          lastAssistantMessage: [{ type: 'text', text: JSON.stringify(result.structured) }],
        }),
      })
    } catch (error) {
      this.ctx.emit('subagent/end', {
        runId: `run-${child.id}` as never,
        provider: this.provider.name,
        id: child.id,
        local: true,
        stopReason: 'error',
        lastAssistantMessage: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
      })
    } finally {
      activation.dispose()
      this.provider.disposals += 1
    }
  }

  private installActivation(child: Agent): { ready: Promise<string>; dispose(): void } {
    type Assembly = { contexts: Array<{ name: string; text: string }> }
    type PromptHandler = (
      assembly: Assembly,
      context: { agent: Agent },
      next: () => Promise<Assembly>,
    ) => Promise<Assembly>
    let promptHandler: PromptHandler | undefined
    const childCtx = {
      agent: child,
      on(event: string, handler: PromptHandler) {
        if (event === 'system-prompt/assemble') promptHandler = handler
        return () => { promptHandler = undefined }
      },
    } as unknown as Context
    const runtime = (this.requiredService() as unknown as { delegations: {
      installActivationSetup(ctx: Context): () => void
    } }).delegations
    const dispose = runtime.installActivationSetup(childCtx)
    const ready = (async () => {
      const handler = promptHandler
      if (handler === undefined) throw new Error(`activation setup did not register a prompt handler for ${child.id}`)
      const assembly: Assembly = { contexts: [] }
      const transformed = await handler(assembly, { agent: child }, async () => assembly)
      return transformed.contexts.find(context => context.name === 'worksurface:delegation-activation')?.text ?? ''
    })()
    return { ready, dispose }
  }

  private emitStart(childId: string): void {
    this.ctx.emit('subagent/start', {
      runId: `run-${childId}` as never,
      provider: this.provider.name,
      id: childId as never,
      local: true,
    })
  }

  private requiredService(): WorkSurfaceService {
    if (this.service === undefined) throw new Error('fixture continuation driver is not attached')
    return this.service
  }
}

function fixtureChild(id: string, parentSession: string): Agent {
  return {
    id,
    session: { header: { version: 0, id, createdAt: 0, origin: 'subagent', delegationDepth: 1, parentSession } },
  } as unknown as Agent
}

function invalidStructuredCompletion(
  task: string,
  surface: string,
  revision: string,
): { matched: boolean; value?: unknown } {
  const completion = {
    surface,
    surfaceRevision: revision,
    summary: 'invalid fixture',
    outputs: [{ surface, block: 'result', revision }],
  }
  switch (task) {
    case 'invalid-object-null': return { matched: true, value: null }
    case 'invalid-object-string': return { matched: true, value: 'invalid' }
    case 'invalid-object-array': return { matched: true, value: [] }
    case 'invalid-surface-number': return { matched: true, value: { ...completion, surface: 1 } }
    case 'invalid-surface-blank': return { matched: true, value: { ...completion, surface: ' ' } }
    case 'invalid-surface-revision-number': return { matched: true, value: { ...completion, surfaceRevision: 1 } }
    case 'invalid-surface-revision-text': return { matched: true, value: { ...completion, surfaceRevision: 'revision' } }
    case 'invalid-summary-number': return { matched: true, value: { ...completion, summary: 1 } }
    case 'invalid-outputs-missing': return { matched: true, value: { ...completion, outputs: undefined } }
    case 'invalid-outputs-empty': return { matched: true, value: { ...completion, outputs: [] } }
    case 'invalid-output-null': return { matched: true, value: { ...completion, outputs: [null] } }
    case 'invalid-output-string': return { matched: true, value: { ...completion, outputs: ['invalid'] } }
    case 'invalid-output-array': return { matched: true, value: { ...completion, outputs: [[]] } }
    case 'invalid-output-surface-number': return {
      matched: true,
      value: { ...completion, outputs: [{ ...completion.outputs[0], surface: 1 }] },
    }
    case 'invalid-output-block-number': return {
      matched: true,
      value: { ...completion, outputs: [{ ...completion.outputs[0], block: 1 }] },
    }
    case 'invalid-output-revision-number': return {
      matched: true,
      value: { ...completion, outputs: [{ ...completion.outputs[0], revision: 1 }] },
    }
    case 'invalid-output-revision-text': return {
      matched: true,
      value: { ...completion, outputs: [{ ...completion.outputs[0], revision: 'revision' }] },
    }
    default: return { matched: false }
  }
}

const roots: string[] = []

afterEach(async () => {
  ScriptedSubprocess.executableResolver = async command => `/fixture/${command}`
  ScriptedSubprocess.runner = async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' })
  ScriptedSubprocess.omitCollected = false
  PassthroughSandbox.enforcement = 'full'
  PassthroughSandbox.policies = []
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface FixtureOptions {
  readonly config?: Omit<Partial<Config>, 'profiles'>
  readonly profiles?: readonly WorkSurfaceProfile[]
}

function pluginProfiles(profiles: readonly WorkSurfaceProfile[]): Array<{
  name: string
  provider: string
  tokenBudget: number
  maxDepth: number
  maxParallel: number
  toolAllow?: string[]
  persona?: string
  agentProvider?: string
  agentModel?: string
}> {
  return profiles.map(({ toolAllow, ...profile }) => toolAllow === undefined
    ? profile
    : { ...profile, toolAllow: [...toolAllow] })
}

async function harnessContext(root: string): Promise<{
  ctx: Context
  provider: EditingProvider
  continuations: FixtureContinuationDriver
}> {
  const ctx = new Context()
  await ctx.plugin(FixtureB2FService, { root: join(root, 'b2f-fallback') })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(ShellEnvRegistry, { dshHome: join(root, 'dsh-home') })
  await ctx.plugin(PassthroughSandbox)
  await ctx.plugin(ScriptedSubprocess)
  const provider = new EditingProvider(ctx)
  ctx.subagents.registerProvider(provider)
  const continuations = new FixtureContinuationDriver(ctx, provider)
  continuations.install()
  return { ctx, provider, continuations }
}

async function fixture(options: FixtureOptions = {}): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  service: WorkSurfaceService
  provider: EditingProvider
  root: string
}> {
  const root = await mkdtemp(join(process.cwd(), '..', '..', '.worksurface-service-'))
  roots.push(root)
  const template = join(root, 'root-template')
  await writeTemplate(template, 'File state B', 'ws-root')
  const store = new WorkSurfaceStore({ root })
  await store.newSurface({ attemptId: 'bootstrap', key: 'root', templatePath: template, surface: 'ws-root' })

  const { ctx, provider, continuations } = await harnessContext(root)
  const fiber = await ctx.plugin(WorkSurfaceService, {
    root,
    attemptsRoot: join(root, 'attempts'),
    socketPath: join(root, 'runtime', 'host.sock'),
    cliEntrypoint: join(process.cwd(), 'packages', 'cli', 'lib', 'bin.js'),
    orchestratorGraceMs: 1000,
    maxOutputBytes: 1024 * 1024,
    maxCrashReplays: 1,
    profiles: pluginProfiles(options.profiles ?? [{
      name: 'test',
      provider: provider.name,
      tokenBudget: 10_000,
      maxDepth: 3,
      maxParallel: 1,
      persona: 'Work only from files.',
    }]),
    ...options.config,
  })
  continuations.attach(ctx.workSurfaces)
  return { ctx, fiber, service: ctx.workSurfaces, provider, root }
}

describe('WorkSurfaceService integration', () => {
  it('resolves the CLI through its package export', async () => {
    const entrypoint = resolveWorkSurfaceCliEntrypoint()
    expect(entrypoint.endsWith(join('packages', 'cli', 'lib', 'bin.js'))).toBe(true)
    expect((await stat(entrypoint)).isFile()).toBe(true)
  })

  it('makes a fresh session WorkSurface visible and runnable without a pre-created root', async () => {
    const { ctx, fiber, service, root } = await fixture()
    const parent = { id: 'fresh-parent', session: { header: { id: 'fresh-parent' } } } as unknown as Agent

    const assembly = await ctx.systemPrompt.assemble({ agent: parent })
    const prompt = renderPrompt(assembly)
    const runtimeContext = renderContextSnapshot(assembly)
    expect(prompt).toContain('PF WorkSurface is active. It externalizes verifiable task state')
    expect(prompt).toContain('without waiting for the user to name it')
    expect(prompt).toContain('Skip it for simple questions and bounded one-step changes')
    expect(prompt).toContain('Before delegating, initialize the root with the goal')
    expect(prompt).toContain('ws help init')
    expect(prompt).toContain('run_orchestrator')
    // A fresh Session renders guidance but no Projection and creates no durable
    // WorkSurface state until it actually uses WorkSurface.
    expect(runtimeContext).not.toContain('PF WorkSurface Projection')
    const currentRoot = (await service.openSessionSurface(parent)).surface
    const initialized = await ctx.systemPrompt.assemble({ agent: parent })
    const initializedContext = renderContextSnapshot(initialized)
    expect(initializedContext).toContain('PF WorkSurface Projection')
    expect(initializedContext).toContain('file=work/root/surface.md')
    expect(initializedContext).not.toContain('worksurface:block')
    expect(initializedContext).toContain('# Acceptance Criteria')
    expect(initializedContext).toContain('# Current Decisions')
    expect(initializedContext).toContain('# Deliverables and Evidence')
    expect(renderPrompt(initialized)).toBe(prompt)
    expect(ctx.shellEnv.collect({ agent: parent } as ToolExecution).DSH_B2F_ROOT).toBeUndefined()
    const selected = await b2fService(ctx).resolveScope(parent, undefined, ['work/root/surface.md'])
    const pending = await service.openSessionWorkspace(parent)
    expect(selected).toMatchObject({ root: pending.workspaceRoot, scope: 'worksurface', authorization: 'mounted-workspace' })
    expect(prompt).not.toContain(currentRoot)
    expect(prompt).toContain('work/root')
    expect(b2fService(ctx).resolveRoot(parent)).toBe(join(root, 'b2f-fallback'))
    expect(b2fService(ctx).resolveRoot(parent, undefined, ['source/file.ts'])).toBe(join(root, 'b2f-fallback'))
    expect(b2fService(ctx).resolveRoot(parent, undefined, ['work/root/surface.md'])).toBe(pending.workspaceRoot)
    expect((await readdir(pending.rootWorkingPath)).sort()).toEqual(['blocks', 'surface.md'])
    const parentEnv = ctx.shellEnv.collect({ agent: parent } as ToolExecution)
    expect(parentEnv.DSH_B2F_ROOT).toBe(pending.workspaceRoot)
    expect(parentEnv.DSH_WS_WORKING_PATH).toBe(pending.rootWorkingPath)
    expect(parentEnv.DSH_WS_BASE_REVISION).toBe(pending.rootBaseRevision)
    const secondParent = { id: 'second-fresh-parent', session: { header: { id: 'second-fresh-parent' } } } as unknown as Agent
    expect(renderPrompt(await ctx.systemPrompt.assemble({ agent: secondParent }))).toBe(prompt)
    const delegated = {
      id: 'delegated-prompt-agent',
      session: { header: { id: 'delegated-prompt-agent', origin: 'subagent', delegationDepth: 1 } },
    } as unknown as Agent
    const delegatedAssembly = await ctx.systemPrompt.assemble({ agent: delegated })
    expect(renderPrompt(delegatedAssembly)).not.toContain('PF WorkSurface is active')
    expect(renderContextSnapshot(delegatedAssembly)).not.toContain('PF WorkSurface Projection')
    const schema = assembly.tools.find(tool => tool.name === 'run_orchestrator')
    expect(schema).toBeDefined()
    expect(schema?.description).toContain('complex, multi-stage work')
    expect(JSON.stringify(schema?.parameters)).toContain('ws help init supplies authoring guidance')
    expect(JSON.stringify(schema?.parameters)).toContain('rootSurface')
    expect(JSON.stringify(schema?.parameters)).not.toContain('"required":["language","script","rootSurface"]')

    let observedRoot = ''
    ScriptedSubprocess.runner = async (spec) => {
      observedRoot = spec.env?.WS_ROOT_SURFACE ?? ''
      expect(spec.cwd).toBe(pending.workspaceRoot)
      expect(PassthroughSandbox.policies.at(-1)?.workspaceRoot).toBe(pending.workspaceRoot)
      expect(spec.env?.DSH_B2F_ROOT).toBe(pending.workspaceRoot)
      expect(spec.env?.WS_ATTEMPT_DIR).toBe(pending.workspaceRoot)
      expect(spec.env?.WS_WORKING_SURFACE).toBe(pending.rootSurface)
      expect(spec.env?.WS_WORKING_PATH).toBe(pending.rootWorkingPath)
      expect(spec.env?.WS_BASE_REVISION).toBe(pending.rootBaseRevision)
      expect(spec.argv.at(-1)?.startsWith(`${pending.workspaceRoot}/`)).toBe(false)
      return { exitCode: 0, signal: null, stdout: observedRoot, stderr: '' }
    }
    const result = await ctx.tools.execute({
      callId: 'fresh-session-orchestrator' as never,
      name: 'run_orchestrator',
      arguments: { language: 'bash', script: 'printf %s "$WS_ROOT_SURFACE"' },
      signal: new AbortController().signal,
      agent: parent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('fresh-session WorkSurface tool failed')
    expect(observedRoot).toMatch(/^ws-/)
    expect(result.value).toMatchObject({
      rootSurface: observedRoot,
      stdout: observedRoot,
      workspaceHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect((await service.openSessionSurface(parent)).surface).toBe(observedRoot)

    await fiber.dispose()
    expect(b2fService(ctx).resolveRoot(parent)).toBe(join(root, 'b2f-fallback'))
    const afterUnload = await ctx.systemPrompt.assemble({ agent: parent })
    expect(renderPrompt(afterUnload)).not.toContain('PF WorkSurface')
    expect(renderContextSnapshot(afterUnload)).not.toContain('PF WorkSurface')
  })

  it('promotes parent b2f Surface edits to the canonical revision exactly once', async () => {
    const { ctx, fiber, service } = await fixture()
    const parent = { id: 'publishing-parent', session: { header: { id: 'publishing-parent' } } } as unknown as Agent
    const current = await service.openSessionSurface(parent)
    const pending = await service.openSessionWorkspace(parent)
    const documentPath = join(pending.rootWorkingPath, 'surface.md')
    const document = await readFile(documentPath, 'utf8')
    await writeFile(documentPath, document.replace('# Goal\n\n', '# Goal\n\nDurable publication.\n\n'))

    const first = await b2fService(ctx).publish({
      agent: parent,
      root: pending.workspaceRoot,
      scope: 'worksurface',
      paths: ['work/root/surface.md'],
      report: { status: 'committed', commit: 'workspace-commit-1', repoRevision: 'workspace-revision-1' },
    })
    expect(first).toMatchObject({ scope: 'worksurface', noOp: false, revision: expect.stringMatching(/^sha256:/) })
    expect((await service.store.readSnapshot(current.surface)).surfaceDocument).toContain('Durable publication.')
    expect((await service.openSessionWorkspace(parent)).rootBaseRevision).toBe(first?.revision)

    const replay = await b2fService(ctx).publish({
      agent: parent,
      root: pending.workspaceRoot,
      scope: 'worksurface',
      paths: ['work/root/surface.md'],
      report: { status: 'unchanged', commit: null, repoRevision: 'workspace-revision-1' },
    })
    expect(replay).toEqual({ scope: 'worksurface', revision: first?.revision, noOp: true })
    expect(await b2fService(ctx).publish({
      agent: parent,
      root: pending.workspaceRoot,
      scope: 'worksurface',
      paths: ['work/input.txt'],
      report: { status: 'committed', commit: 'workspace-commit-2', repoRevision: 'workspace-revision-2' },
    })).toBeUndefined()

    await fiber.dispose()
  })

  it('removes unclaimed workspaces on Agent disposal and plugin unload', async () => {
    const { ctx, fiber, service, root } = await fixture()
    const disposed = { id: 'disposed-pending', session: { header: { id: 'disposed-pending' } } } as unknown as Agent
    const first = await service.openSessionWorkspace(disposed)

    ctx.emit('agent/disposed', { agent: disposed })

    expect(b2fService(ctx).resolveRoot(disposed)).toBe(join(root, 'b2f-fallback'))
    await vi.waitFor(async () => {
      await expect(stat(first.root)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    const unloading = { id: 'unloading-pending', session: { header: { id: 'unloading-pending' } } } as unknown as Agent
    const second = await service.openSessionWorkspace(unloading)
    await fiber.dispose()
    await expect(stat(second.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not publish a pending workspace after its Agent is disposed', async () => {
    const { ctx, service, root } = await fixture()
    const agent = { id: 'disposed-initializing', session: { header: { id: 'disposed-initializing' } } } as unknown as Agent
    const current = await service.openSessionSurface(agent)
    const originalCheckout = service.store.checkout.bind(service.store)
    let releaseCheckout: () => void = () => {}
    const checkoutGate = new Promise<void>((resolve) => {
      releaseCheckout = resolve
    })
    const checkout = vi.spyOn(service.store, 'checkout').mockImplementation(async request => {
      await checkoutGate
      return originalCheckout(request)
    })

    const opening = service.openSessionWorkspace(agent, current)
    await vi.waitFor(() => expect(checkout).toHaveBeenCalledOnce())
    ctx.emit('agent/disposed', { agent })
    releaseCheckout()

    await expect(opening).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(async () => {
      expect(await readdir(join(root, 'attempts'))).toEqual([])
    })
    expect(b2fService(ctx).resolveRoot(agent)).toBe(join(root, 'b2f-fallback'))
    await expect(service.openSessionWorkspace(agent, current)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('claims b2f workspaces, commits their prepared root checkout, and hashes public inputs', async () => {
    const { ctx, service } = await fixture()
    const parent = { id: 'b2f-parent', session: { header: { id: 'b2f-parent' } } } as unknown as Agent
    const current = await service.openSessionSurface(parent)
    await ctx.systemPrompt.assemble({ agent: parent })
    const firstWorkspace = await service.openSessionWorkspace(parent)
    expect(b2fService(ctx).resolveRoot(parent)).not.toBe(firstWorkspace.workspaceRoot)
    expect(b2fService(ctx).resolveRoot(parent, undefined, ['work/root/surface.md'])).toBe(firstWorkspace.workspaceRoot)

    const firstSurfacePath = join(firstWorkspace.rootWorkingPath, 'surface.md')
    await writeFile(firstSurfacePath, `${await readFile(firstSurfacePath, 'utf8')}\nFirst b2f edit.\n`)
    await writeFile(join(firstWorkspace.workspaceRoot, 'input.txt'), 'first input\n')
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      await client.call('commit', {
        workingPath: requiredEnv(spec.env?.WS_WORKING_PATH),
        baseRevision: requiredEnv(spec.env?.WS_BASE_REVISION),
        key: 'prepared-root',
      })
      return { exitCode: 0, signal: null, stdout: 'committed prepared root', stderr: '' }
    }

    const first = await service.runOrchestrator(
      parent,
      'bash',
      'ws commit "$WS_WORKING_PATH" --base "$WS_BASE_REVISION" --key prepared-root',
      current.surface,
      new AbortController().signal,
    )
    expect(first.workspaceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect((await service.store.readSnapshot(current.surface)).surfaceDocument).toContain('First b2f edit.')
    const firstEvents = (await service.store.readWorkSession(current.surface)).events
    expect(firstEvents.map(event => event.type)).toEqual(expect.arrayContaining([
      'orchestrator/defined',
      'orchestrator/run-started',
      'surface/revision-published',
      'orchestrator/run-completed',
    ]))
    expect(await service.store.readSessionBinding({ surface: current.surface })).toMatchObject({
      sessionId: 'b2f-parent',
      role: 'root',
    })
    await expect(service.store.readOrchestratorDefinition(`sha256:${first.codeHash}`)).resolves.toMatchObject({
      language: 'bash',
      source: 'ws commit "$WS_WORKING_PATH" --base "$WS_BASE_REVISION" --key prepared-root',
    })

    await ctx.systemPrompt.assemble({ agent: parent })
    const secondWorkspace = await service.openSessionWorkspace(parent)
    expect(secondWorkspace.root).not.toBe(firstWorkspace.root)
    expect(await readFile(join(secondWorkspace.rootWorkingPath, 'surface.md'), 'utf8')).toContain('First b2f edit.')
    const secondSurfacePath = join(secondWorkspace.rootWorkingPath, 'surface.md')
    await writeFile(secondSurfacePath, `${await readFile(secondSurfacePath, 'utf8')}\nSecond b2f edit.\n`)
    await writeFile(join(secondWorkspace.workspaceRoot, 'input.txt'), 'second input\n')

    const second = await service.runOrchestrator(
      parent,
      'bash',
      'ws commit "$WS_WORKING_PATH" --base "$WS_BASE_REVISION" --key prepared-root',
      current.surface,
      new AbortController().signal,
    )
    expect(second.codeHash).toBe(first.codeHash)
    expect(second.workspaceHash).not.toBe(first.workspaceHash)
    expect(second.attemptId).not.toBe(first.attemptId)
    expect((await service.store.readSnapshot(current.surface)).surfaceDocument).toContain('Second b2f edit.')
  })

  it('runs Bash, the generated ws wrapper, the CLI socket client, and a child Agent end to end', async () => {
    const { service, provider, root } = await fixture()
    ScriptedSubprocess.executableResolver = async command => {
      if (command !== 'bash') throw new Error(`unexpected real E2E executable '${command}'`)
      return '/bin/bash'
    }
    ScriptedSubprocess.runner = runLocalProcess
    const script = [
      'set -eu',
      'template="$WS_ATTEMPT_DIR/child-template"',
      'mkdir -p "$template/blocks"',
      "cat > \"$template/surface.md\" <<'EOF'",
      '# Real E2E child',
      'EOF',
      "cat > \"$template/blocks/result.md\" <<'EOF'",
      '---',
      'block_id: result',
      'surface_id: template',
      'kind: result',
      'status: active',
      'derived_from: []',
      '---',
      'Initial E2E evidence.',
      'EOF',
      'ws agent run --surface ws-real-e2e-child --task real-e2e --profile test --key child-agent --from "$template" --parent "$WS_ROOT_SURFACE" --result "$WS_ATTEMPT_DIR/results/child.json" --json > "$WS_ATTEMPT_DIR/results/agent.json"',
    ].join('\n')
    const parent = { id: 'real-e2e-parent', session: { header: { id: 'real-e2e-parent' } } } as unknown as Agent

    const result = await service.runOrchestrator(parent, 'bash', script, 'ws-root', new AbortController().signal)

    expect(result).toMatchObject({ exitCode: 0, signal: null, stderr: '' })
    expect(provider.starts).toBe(1)
    expect(await service.store.readSessionBinding({ surface: 'ws-real-e2e-child' })).toMatchObject({
      sessionId: 'child-1',
      role: 'delegated',
      rootSurface: 'ws-root',
      outputRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    const graph = await service.store.graphSnapshot('ws-root')
    expect(graph.nodes.map(node => node.surface).sort()).toEqual(['ws-real-e2e-child', 'ws-root'])
    expect(graph.nodes.find(node => node.surface === 'ws-real-e2e-child')).toMatchObject({
      sessionId: 'child-1',
      phase: 'completed',
      parent: 'ws-root',
    })
    expect((await service.store.readWorkSession('ws-root')).events.map(event => event.type)).toEqual(expect.arrayContaining([
      'orchestrator/defined',
      'orchestrator/run-started',
      'orchestrator/run-completed',
    ]))
    expect((await service.store.readWorkSession('ws-real-e2e-child')).events.map(event => event.type)).toEqual([
      'surface/created',
      'surface/revision-published',
    ])
    expect((await readdir(join(root, 'canonical', 'surfaces'))).sort()).toEqual(['ws-real-e2e-child', 'ws-root'])
  })

  it('cold-resumes the same incomplete child Session after the WorkSurface service is reconstructed', async () => {
    const first = await fixture()
    const template = join(first.root, 'cold-child-template')
    await writeTemplate(template, 'Cold child', 'ws-cold-child')
    const child = await first.service.store.newSurface({
      attemptId: 'cold-bootstrap', key: 'child', templatePath: template,
      surface: 'ws-cold-child', parent: 'ws-root',
    })
    const projection = await first.service.projections.compile({
      surface: child.surface, profile: 'test', tokenBudget: 10_000,
    })
    await first.service.store.bindSession({
      surface: child.surface,
      sessionId: 'cold-child-session',
      role: 'delegated',
      execution: 'continuable',
      rootSurface: 'ws-root',
      parentSessionId: 'cold-parent-session',
      input: {
        surfaceRevision: projection.surfaceRevision,
        blockRevisions: projection.blockRevisions,
        omittedBlockRevisions: projection.omittedFiles.map(file => ({
          surface: file.surfaceId, block: file.blockId, revision: file.revision,
        })),
        profile: projection.profile,
        task: 'finish after cold restart',
      },
    })
    await first.fiber.dispose()

    const { ctx, provider, continuations } = await harnessContext(first.root)
    const secondFiber = await ctx.plugin(WorkSurfaceService, {
      root: first.root,
      attemptsRoot: join(first.root, 'attempts-restarted'),
      socketPath: join(first.root, 'runtime', 'host-restarted.sock'),
      cliEntrypoint: join(process.cwd(), 'packages', 'cli', 'lib', 'bin.js'),
      profiles: pluginProfiles([{
        name: 'test', provider: provider.name, tokenBudget: 10_000, maxDepth: 3, maxParallel: 1,
      }]),
    })
    const restarted = ctx.workSurfaces
    continuations.attach(restarted)
    ScriptedSubprocess.runner = async (spec) => {
      const completion = await orchestratorClient(spec).call('agent.run', {
        surface: 'ws-cold-child', task: 'finish after cold restart', profile: 'test', key: 'cold-resume',
      }) as { summary: string }
      return { exitCode: 0, signal: null, stdout: completion.summary, stderr: '' }
    }
    const parent = {
      id: 'cold-parent-session', session: { header: { id: 'cold-parent-session' } },
    } as unknown as Agent

    await expect(restarted.runOrchestrator(
      parent, 'bash', '# cold resume', 'ws-root', new AbortController().signal,
    )).resolves.toMatchObject({ stdout: 'completed finish after cold restart' })
    expect(provider.starts).toBe(0)
    await expect(restarted.store.readSessionBinding({ surface: 'ws-cold-child' })).resolves.toMatchObject({
      version: 2,
      sessionId: 'cold-child-session',
      completion: { summary: 'completed finish after cold restart' },
    })
    await secondFiber.dispose()
  })

  it('releases activation setup when binding fails before its delayed canonical lookup completes', async () => {
    const { service, provider } = await fixture()
    const lookupGate = Promise.withResolvers<void>()
    const originalRead = service.store.readSessionBinding.bind(service.store)
    service.store.readSessionBinding = async identity => {
      if ('sessionId' in identity && identity.sessionId === 'child-1') {
        await lookupGate.promise
        return undefined
      }
      return originalRead(identity)
    }
    const originalBind = service.store.bindSession.bind(service.store)
    service.store.bindSession = async options => {
      if (options.role === 'delegated') {
        throw new WorkSurfaceError('session-binding-conflict', 'injected binding failure before activation lookup')
      }
      return originalBind(options)
    }
    const runtime = (service as unknown as { delegations: {
      bindingFailed(sessionId: string, error: unknown): void
    } }).delegations
    const originalBindingFailed = runtime.bindingFailed.bind(runtime)
    runtime.bindingFailed = (sessionId, error) => {
      originalBindingFailed(sessionId, error)
      lookupGate.resolve()
    }
    ScriptedSubprocess.runner = async (spec) => {
      const template = join(spec.cwd, 'binding-race-template')
      await writeTemplate(template, 'Binding race child', 'ws-binding-race')
      await expectCode(orchestratorClient(spec).call('agent.run', {
        surface: 'ws-binding-race', task: 'binding-race', profile: 'test', key: 'binding-race',
        templatePath: template, parent: 'ws-root',
      }), 'session-binding-conflict')
      return { exitCode: 0, signal: null, stdout: '', stderr: '' }
    }
    const parent = { id: 'binding-race-parent', session: { header: { id: 'binding-race-parent' } } } as unknown as Agent

    await expect(service.runOrchestrator(
      parent, 'bash', '# binding race', 'ws-root', new AbortController().signal,
    )).resolves.toMatchObject({ exitCode: 0 })
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(provider.disposals).toBe(1)
  })

  it('runs a committed control file, stores it by content, and re-runs it as one attempt', async () => {
    const { service } = await fixture()
    const parent = { id: 'control-parent', session: { header: { id: 'control-parent' } } } as unknown as Agent
    const current = await service.openSessionSurface(parent)
    const workspace = await service.openSessionWorkspace(parent)
    await mkdir(join(workspace.workspaceRoot, 'work', 'control'), { recursive: true })
    await writeFile(join(workspace.workspaceRoot, 'work', 'control', 'plan.sh'), 'echo control-run\n')

    let observedSource = ''
    ScriptedSubprocess.runner = async (spec) => {
      const scriptPath = spec.argv.at(-1)
      expect(scriptPath).toBeDefined()
      observedSource = await readFile(scriptPath as string, 'utf8')
      return { exitCode: 0, signal: null, stdout: 'control-ended', stderr: '' }
    }

    const first = await service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, 'work/control/plan.sh',
    )
    expect(observedSource).toBe('echo control-run\n')
    expect(first).toMatchObject({ exitCode: 0, stdout: 'control-ended' })
    expect(await service.store.readOrchestratorDefinition(`sha256:${first.codeHash}`)).toMatchObject({
      language: 'bash',
      source: 'echo control-run\n',
    })
    const events = (await service.store.readWorkSession(current.surface)).events
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      'orchestrator/defined',
      'orchestrator/run-started',
      'orchestrator/run-completed',
    ]))

    // Re-running the same control by its stored content-addressed definition
    // revision replays the task against a fresh workspace as a new attempt.
    const second = await service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, `sha256:${first.codeHash}`,
    )
    expect(second.codeHash).toBe(first.codeHash)
    expect(second.attemptId).not.toBe(first.attemptId)
    expect(observedSource).toBe('echo control-run\n')
    const rerunEvents = (await service.store.readWorkSession(current.surface)).events
    expect(rerunEvents.filter(event => event.type === 'orchestrator/defined')).toHaveLength(1)
    expect(rerunEvents.filter(event => event.type === 'orchestrator/run-started')).toHaveLength(2)
    expect(rerunEvents.filter(event => event.type === 'orchestrator/run-completed')).toHaveLength(2)
  })

  it('rejects invalid control references and both/neither script arguments', async () => {
    const { service } = await fixture()
    const parent = { id: 'control-errors', session: { header: { id: 'control-errors' } } } as unknown as Agent
    const current = await service.openSessionSurface(parent)
    await service.openSessionWorkspace(parent)

    await expectCode(service.runOrchestrator(parent, 'bash', '', current.surface, new AbortController().signal), 'invalid-working-copy')
    await expectCode(service.runOrchestrator(
      parent, 'bash', 'echo inline', current.surface, new AbortController().signal, 'work/control/plan.sh',
    ), 'invalid-working-copy')
    await expectCode(service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, '../escape.sh',
    ), 'unauthorized')
    await expectCode(service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, '/etc/hosts',
    ), 'unauthorized')
    await expectCode(service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, 'work/control/missing.sh',
    ), 'not-found')
    await expectCode(service.runOrchestrator(
      parent, 'bash', '', current.surface, new AbortController().signal, `sha256:${'a'.repeat(64)}`,
    ), 'not-found')
  })

  it('uses the session root when a model sends an empty optional rootSurface', async () => {
    const { ctx, fiber, service } = await fixture()
    const parent = { id: 'empty-root-parent', session: { header: { id: 'empty-root-parent' } } } as unknown as Agent
    let observedRoot = ''
    ScriptedSubprocess.runner = async (spec) => {
      observedRoot = spec.env?.WS_ROOT_SURFACE ?? ''
      return { exitCode: 0, signal: null, stdout: '', stderr: '' }
    }

    const result = await ctx.tools.execute({
      callId: 'empty-root-orchestrator' as never,
      name: 'run_orchestrator',
      arguments: { language: 'bash', script: 'true', rootSurface: '  ' },
      signal: new AbortController().signal,
      agent: parent,
    })

    expect(result.isError).toBe(false)
    expect(observedRoot).toBe((await service.openSessionSurface(parent)).surface)

    const explicit = await ctx.tools.execute({
      callId: 'explicit-root-orchestrator' as never,
      name: 'run_orchestrator',
      arguments: { language: 'bash', script: 'printf explicit', rootSurface: observedRoot },
      signal: new AbortController().signal,
      agent: parent,
    })
    expect(explicit.isError).toBe(false)
    await fiber.dispose()
  })

  it('uses file Projection, requires committed structured refs, replays Agent keys, and cleans up', async () => {
    const { ctx, fiber, service, provider, root } = await fixture()
    const observed: Record<string, string> = {}
    ScriptedSubprocess.runner = async (spec) => {
      expect(spec.env?.WS_ROOT_SURFACE).toBe('ws-root')
      expect(spec.env?.WS_WORKING_SURFACE).toMatch(/^ws-/)
      expect(spec.env?.WS_WORKING_SURFACE).toBe(spec.env?.WS_ROOT_SURFACE)
      const client = orchestratorClient(spec)
      const validSurface = await createAgentSurface(client, spec, 'agent-valid')
      const valid = await client.call('agent.run', {
        surface: validSurface, task: 'valid', profile: 'test', key: 'agent-valid',
      }) as { surfaceRevision: string }
      const replay = await client.call('agent.run', {
        surface: validSurface, task: 'valid', profile: 'test', key: 'agent-valid',
      }) as { surfaceRevision: string }
      expect(replay).toEqual(valid)
      for (const [name, task, key] of [
        ['uncommitted', 'uncommitted', 'agent-uncommitted'],
        ['missing', 'missing', 'agent-missing'],
        ['wrong', 'wrong-revision', 'agent-wrong'],
        ['key-conflict', 'different task', 'agent-valid'],
      ] as const) {
        const surface = name === 'key-conflict' ? validSurface : await createAgentSurface(client, spec, key)
        try {
          await client.call('agent.run', { surface, task, profile: 'test', key })
          observed[name] = 'unexpected-success'
        } catch (error) {
          observed[name] = (error as { code?: string }).code ?? 'unknown'
        }
      }
      return { exitCode: 0, signal: null, stdout: JSON.stringify(observed), stderr: '' }
    }
    const parent = { id: 'parent', session: { header: { id: 'parent' } } } as unknown as Agent
    const result = await service.runOrchestrator(parent, 'bash', '# ordinary script fixture', 'ws-root', new AbortController().signal)

    expect(result.exitCode).toBe(0)
    expect(observed).toEqual({
      uncommitted: 'invalid-reference',
      missing: 'dangling-reference',
      wrong: 'invalid-reference',
      'key-conflict': 'idempotency-key-conflict',
    })
    expect(provider.starts).toBe(8)
    expect(provider.disposals).toBe(4)
    expect(provider.b2fRoots).toHaveLength(4)
    expect(provider.b2fRoots.every(root => root.includes(`${join('workspace', 'work')}`))).toBe(true)
    expect(provider.personas[0]).toContain('Agent Surface agent-valid')
    expect(provider.personas[0]).not.toContain('Conversation state A')
    expect(provider.personas[0]).toMatch(/base revision is sha256:[0-9a-f]{64}/)
    expect(ctx.tools.schemas().some(schema => schema.name === 'run_orchestrator')).toBe(true)
    let rawFsExecuted = false
    ctx.tools.register(defineTool({
      name: 'raw_fs_fixture',
      description: 'fixture that would perform an unmediated file effect',
      parameters: { path: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() { rawFsExecuted = true; return 'ran' },
    }))
    const guarded = await ctx.tools.execute({
      callId: 'guarded' as never,
      name: 'raw_fs_fixture',
      arguments: { path: service.store.canonicalRoot },
      signal: new AbortController().signal,
    })
    expect(guarded.isError).toBe(true)
    expect(rawFsExecuted).toBe(false)

    const socketPath = join(root, 'runtime', 'host.sock')
    await fiber.dispose()
    await expect(stat(socketPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ctx.tools.schemas().some(schema => schema.name === 'run_orchestrator')).toBe(false)
    const afterUnload = await ctx.tools.execute({
      callId: 'after-unload' as never,
      name: 'raw_fs_fixture',
      arguments: { path: service.store.canonicalRoot },
      signal: new AbortController().signal,
    })
    expect(afterUnload.isError).toBe(false)
    expect(rawFsExecuted).toBe(true)
  })

  it('gives a child credential access only to its assigned Surface', async () => {
    const { service, provider, root } = await fixture()
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const template = join(spec.cwd, 'child-template')
      await writeTemplate(template, 'child B', 'ws-child')
      await client.call('agent.run', {
        surface: 'ws-child', task: 'isolation', profile: 'test', key: 'agent-isolation',
        templatePath: template, parent: 'ws-root',
      })
      return { exitCode: 0, signal: null, stdout: 'isolated', stderr: '' }
    }
    const parent = { id: 'parent-isolation', session: { header: { id: 'parent-isolation' } } } as unknown as Agent
    const result = await service.runOrchestrator(parent, 'bash', '# isolation fixture', 'ws-root', new AbortController().signal)
    expect(result.exitCode).toBe(0)
    expect(provider.isolationFailures).toEqual(['unauthorized'])
    expect(await stat(join(root, 'canonical', 'surfaces', 'ws-root'))).toBeDefined()
  })

  it('waits for in-flight Agent operations to become quiescent before returning', async () => {
    const { service, provider } = await fixture()
    let agentCall: Promise<unknown> | undefined
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const surface = await createAgentSurface(client, spec, 'quiescence')
      agentCall = client.call('agent.run', {
        surface, task: 'quiescence', profile: 'test', key: 'agent-quiescence',
      })
      await provider.quiescenceReady
      return { exitCode: 0, signal: null, stdout: 'script-ended', stderr: '' }
    }
    const parent = { id: 'parent-quiescence', session: { header: { id: 'parent-quiescence' } } } as unknown as Agent
    let returned = false
    const execution = service
      .runOrchestrator(parent, 'bash', '# quiescence fixture', 'ws-root', new AbortController().signal)
      .then((result) => { returned = true; return result })
    await provider.quiescenceReady
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(returned).toBe(false)

    provider.releaseQuiescence()
    const result = await execution
    await agentCall
    expect(result.exitCode).toBe(0)
    expect(provider.disposals).toBe(1)
  })

  it('covers session prompt, tool, guard, and capability lifecycle failures', async () => {
    const { ctx, fiber, service } = await fixture()
    const parent = { id: 'prompt-parent', session: { header: { id: 'prompt-parent' } } } as unknown as Agent

    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).not.toContain('PF WorkSurface')
    expect(Object.keys(ctx.shellEnv.collect({} as ToolExecution)).some(key => key.startsWith('DSH_WS_'))).toBe(false)
    expect(Object.keys(ctx.shellEnv.collect({ agent: parent } as ToolExecution)).some(key => key.startsWith('DSH_WS_'))).toBe(false)
    expect(ctx.tools.get('run_orchestrator')?.isConcurrencySafe?.({ language: 'bash', script: 'true' })).toBe(false)

    const withoutAgent = await ctx.tools.execute({
      callId: 'without-agent' as never,
      name: 'run_orchestrator',
      arguments: { language: 'bash', script: 'true', rootSurface: 'ws-root' },
      signal: new AbortController().signal,
    })
    expect(withoutAgent.isError).toBe(true)

    let safeRuns = 0
    ctx.tools.register(defineTool({
      name: 'safe_fixture',
      description: 'Fixture with an argument that does not expose canonical state.',
      parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { safeRuns += 1; return 'safe' },
    }))
    const safe = await ctx.tools.execute({
      callId: 'safe' as never,
      name: 'safe_fixture',
      arguments: { value: 'ordinary' },
      signal: new AbortController().signal,
    })
    expect(safe.isError).toBe(false)
    expect(safeRuns).toBe(1)

    let circularRuns = 0
    ctx.tools.register({
      name: 'circular_fixture',
      description: 'Unvalidated fixture for a non-JSON argument.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute() { circularRuns += 1; return 'circular' },
    } as never)
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect((ctx.tools as unknown as { guardReason(exec: ToolExecution): string | undefined }).guardReason({
      name: 'circular_fixture', arguments: circular,
    } as ToolExecution)).toBeUndefined()
    const circularResult = await ctx.tools.execute({
      callId: 'circular' as never,
      name: 'circular_fixture',
      arguments: circular,
      signal: new AbortController().signal,
    })
    expect(circularResult.isError).toBe(true)
    expect(circularRuns).toBe(0)

    const before = new AbortController()
    before.abort()
    await expect(ctx.systemPrompt.assemble({ agent: parent, signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })

    const after = new AbortController()
    await service.openSessionSurface(parent)
    const compile = service.projections.compile.bind(service.projections)
    vi.spyOn(service.projections, 'compile').mockImplementationOnce(async (request) => {
      const projection = await compile(request)
      after.abort()
      return projection
    })
    await expect(ctx.systemPrompt.assemble({ agent: parent, signal: after.signal })).rejects.toMatchObject({ name: 'AbortError' })

    const duplicate = { id: parent.id, session: parent.session } as unknown as Agent
    expect((await service.openSessionSurface(duplicate)).surface).toBe((await service.openSessionSurface(parent)).surface)
    const alreadyExisting = { id: parent.id, session: parent.session } as unknown as Agent
    const alreadyExists = vi.spyOn(service.store, 'newSurface')
      .mockRejectedValueOnce(new WorkSurfaceError('already-exists', 'session Surface already exists'))
    expect((await service.openSessionSurface(alreadyExisting)).surface).toMatch(/^ws-/)
    alreadyExists.mockRestore()
    const failing = { id: 'failing-session', session: { header: { id: 'failing-session' } } } as unknown as Agent
    const newSurface = vi.spyOn(service.store, 'newSurface')
      .mockRejectedValueOnce(new WorkSurfaceError('effect-failed', 'session initialization failed'))
    await expect(service.openSessionSurface(failing)).rejects.toMatchObject({ code: 'effect-failed' })
    newSurface.mockRestore()
    expect((await service.openSessionSurface(failing)).surface).toMatch(/^ws-/)

    const configuredProfiles = service.config.profiles
    ;(service.config as { profiles: readonly WorkSurfaceProfile[] }).profiles = []
    const emptyProfileAgent = { id: 'empty-profile', session: { header: { id: 'empty-profile' } } } as unknown as Agent
    await service.openSessionSurface(emptyProfileAgent)
    await expect(ctx.systemPrompt.assemble({ agent: emptyProfileAgent })).rejects.toMatchObject({ code: 'unsupported-profile' })
    ;(service.config as { profiles: readonly WorkSurfaceProfile[] }).profiles = configuredProfiles

    await fiber.dispose()
    expect(() => (service as unknown as { requireHarness(): unknown }).requireHarness())
      .toThrow(expect.objectContaining({ code: 'effect-failed' }))
  })

  it('dispatches every Host operation and rejects invalid authority, inputs, and paths', async () => {
    const { ctx, service, root } = await fixture()
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const unrelated = { id: 'unrelated-agent', session: { header: { id: 'unrelated-agent' } } } as unknown as Agent
      expect(Object.keys(ctx.shellEnv.collect({ agent: unrelated } as ToolExecution)).some(key => key.startsWith('DSH_WS_'))).toBe(false)
      const initial = await client.call('show', { surface: 'ws-root' }) as { revision: string }
      await client.call('show', { surface: 'ws-root', revision: initial.revision })
      await client.call('projection', { surface: 'ws-root', profile: 'test', tokenBudget: 1000 })
      await client.call('projection', { surface: 'ws-root', profile: 'test', tokenBudget: 1000, revision: initial.revision })

      const checkout = join(spec.cwd, 'work', 'manual')
      await client.call('checkout', { surface: 'ws-root', targetPath: checkout })
      const pinnedCheckout = join(spec.cwd, 'work', 'pinned')
      await client.call('checkout', { surface: 'ws-root', targetPath: pinnedCheckout, revision: initial.revision })
      await writeFile(join(checkout, 'surface.md'), `${await readFile(join(checkout, 'surface.md'), 'utf8')}\nCommitted manually.\n`)
      const committed = await client.call('commit', {
        workingPath: checkout,
        baseRevision: initial.revision,
        key: 'manual-commit',
        retry: true,
      }) as { revision: string }
      await client.call('show', { surface: 'ws-root', revision: committed.revision })

      // A delegated work unit is created by its delegation: agent.run admits and
      // materializes an unadmitted Surface from the provided template.
      const createdTemplate = join(spec.cwd, 'created-template')
      await writeTemplate(createdTemplate, 'created child', 'ws-created')
      await client.call('agent.run', {
        surface: 'ws-created', task: 'valid', profile: 'test', key: 'create-and-run',
        templatePath: createdTemplate, parent: 'ws-root',
      })
      await client.call('show', { surface: 'ws-created' })
      await expectCode(client.call('agent.run', {
        surface: 'ws-unadmitted', task: 'valid', profile: 'test', key: 'unadmitted',
      }), 'unauthorized')

      const attemptId = requiredEnv(spec.env?.WS_ATTEMPT_ID)
      const token = requiredEnv(spec.env?.WS_ATTEMPT_TOKEN)
      const aborted = new AbortController()
      aborted.abort()
      await expectCode(service.dispatch({
        id: 'aborted', method: 'show', attemptId, token, params: { surface: 'ws-root' },
      }, aborted.signal), 'cancelled')
      await expectCode(service.dispatch({
        id: 'missing', method: 'show', attemptId: 'missing', token, params: { surface: 'ws-root' },
      }, new AbortController().signal), 'unauthorized')
      await expectCode(service.dispatch({
        id: 'bad-token', method: 'show', attemptId, token: 'bad', params: { surface: 'ws-root' },
      }, new AbortController().signal), 'unauthorized')

      await expectCode(client.call('show', { surface: 'ws-unowned' }), 'unauthorized')
      await expectCode(client.call('show', { surface: '' }), 'invalid-working-copy')
      await expectCode(client.call('show', { surface: 1 }), 'invalid-working-copy')
      await expectCode(client.call('show', { surface: 'ws-root', revision: 1 }), 'invalid-working-copy')
      await expectCode(client.call('projection', { surface: 'ws-root', profile: 'test', tokenBudget: 0 }), 'invalid-working-copy')
      await expectCode(client.call('projection', { surface: 'ws-root', profile: 'test', tokenBudget: 1.5 }), 'invalid-working-copy')
      await expectCode(client.call('checkout', { surface: 'ws-root', targetPath: '../escape' }), 'unauthorized')

      await symlink(join(root, 'outside'), join(spec.cwd, 'escape-link'))
      await expectCode(client.call('checkout', { surface: 'ws-root', targetPath: 'escape-link/child' }), 'unauthorized')
      await writeFile(join(spec.cwd, 'regular-file'), 'not a directory')
      await expect(client.call('checkout', { surface: 'ws-root', targetPath: 'regular-file/child' })).rejects.toBeDefined()
      return { exitCode: 0, signal: null, stdout: 'dispatch-covered', stderr: '' }
    }

    const parent = { id: 'dispatch-parent', session: { header: { id: 'dispatch-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', '# dispatch', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: 'dispatch-covered' })
  })

  it('handles Orchestrator language, replay, cancellation, collision, and sandbox branches', async () => {
    const { service } = await fixture()
    const parent = { id: 'orchestrator-parent', session: { header: { id: 'orchestrator-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', ' ', 'ws-root', new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-working-copy' })

    let pythonRuns = 0
    const savedPath = process.env.PATH
    delete process.env.PATH
    try {
      ScriptedSubprocess.runner = async (spec) => {
        pythonRuns += 1
        expect(spec.argv.at(-1)).toContain('main.py')
        return pythonRuns === 1
          ? { exitCode: null, signal: 'SIGKILL', stdout: 'first', stderr: 'first-error' }
          : { exitCode: 0, signal: null, stdout: 'second', stderr: '' }
      }
      await expect(service.runOrchestrator(parent, 'python', 'print("ok")', 'ws-root', new AbortController().signal))
        .resolves.toMatchObject({ replayCount: 1, stdout: 'second', stderr: '' })
    } finally {
      if (savedPath === undefined) delete process.env.PATH
      else process.env.PATH = savedPath
    }

    ScriptedSubprocess.omitCollected = true
    ScriptedSubprocess.runner = async () => ({ exitCode: 0, signal: null, stdout: 'hidden', stderr: 'hidden' })
    await expect(service.runOrchestrator(parent, 'bash', 'echo hidden', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: '', stderr: '' })
    ScriptedSubprocess.omitCollected = false

    const cancelled = new AbortController()
    ScriptedSubprocess.runner = async () => {
      cancelled.abort()
      return { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' }
    }
    await expect(service.runOrchestrator(parent, 'bash', 'echo cancel', 'ws-root', cancelled.signal))
      .resolves.toMatchObject({ replayCount: 0, signal: 'SIGTERM' })

    PassthroughSandbox.enforcement = 'partial'
    await expect(service.runOrchestrator(parent, 'bash', 'echo unsafe', 'ws-root', new AbortController().signal))
      .rejects.toMatchObject({ code: 'unauthorized' })
    PassthroughSandbox.enforcement = 'full'

    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ScriptedSubprocess.runner = async () => {
      started.resolve(undefined)
      await release.promise
      return { exitCode: 0, signal: null, stdout: '', stderr: '' }
    }
    const first = service.runOrchestrator(parent, 'bash', 'echo collision', 'ws-root', new AbortController().signal)
    await started.promise
    await expect(service.runOrchestrator(parent, 'bash', 'echo collision', 'ws-root', new AbortController().signal))
      .rejects.toMatchObject({ code: 'effect-failed' })
    release.resolve(undefined)
    await first
  })

  it('rejects every invalid child completion and least-authority violation', async () => {
    const { service, provider } = await fixture()
    const invalidTasks = [
      ['invalid-object-null', 'invalid-reference'],
      ['invalid-object-string', 'invalid-reference'],
      ['invalid-object-array', 'invalid-reference'],
      ['invalid-surface-number', 'invalid-working-copy'],
      ['invalid-surface-blank', 'invalid-working-copy'],
      ['invalid-surface-revision-number', 'invalid-working-copy'],
      ['invalid-surface-revision-text', 'invalid-reference'],
      ['invalid-summary-number', 'invalid-working-copy'],
      ['invalid-outputs-missing', 'invalid-reference'],
      ['invalid-outputs-empty', 'invalid-reference'],
      ['invalid-output-null', 'invalid-reference'],
      ['invalid-output-string', 'invalid-reference'],
      ['invalid-output-array', 'invalid-reference'],
      ['invalid-output-surface-number', 'invalid-working-copy'],
      ['invalid-output-block-number', 'invalid-working-copy'],
      ['invalid-output-revision-number', 'invalid-working-copy'],
      ['invalid-output-revision-text', 'invalid-reference'],
    ] as const
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      for (const [task, code] of invalidTasks) {
        const surface = await createAgentSurface(client, spec, task)
        await expectCode(client.call('agent.run', {
          surface, task, profile: 'test', key: task,
        }), code)
      }
      for (const [task, code] of [
        ['stopped', 'effect-failed'],
        ['different-surface', 'unauthorized'],
        ['different-output-surface', 'unauthorized'],
        ['wrong-surface-revision', 'invalid-reference'],
        ['wrong-output-revision', 'invalid-reference'],
        ['foreign-commit', 'unauthorized'],
        ['start-failed', 'effect-failed'],
      ] as const) {
        const surface = await createAgentSurface(client, spec, task)
        await expectCode(client.call('agent.run', {
          surface, task, profile: 'test', key: task,
        }), code)
      }
      const authoritySurface = await createAgentSurface(client, spec, 'authority-errors')
      await client.call('agent.run', {
        surface: authoritySurface, task: 'authority-errors', profile: 'test', key: 'authority-errors',
      })
      const optionSurface = await createAgentSurface(client, spec, 'option-errors')
      await expectCode(client.call('agent.run', {
        surface: optionSurface, task: 'valid', profile: 'missing', key: 'missing-profile',
      }), 'unsupported-profile')
      await expectCode(client.call('agent.run', {
        surface: optionSurface, task: 'valid', profile: 'test', key: 'bad/key',
      }), 'invalid-id')
      const retrySurface = await createAgentSurface(client, spec, 'retry-stopped')
      await expectCode(client.call('agent.run', {
        surface: retrySurface, task: 'stopped', profile: 'test', key: 'retry-stopped',
      }), 'effect-failed')
      await expectCode(client.call('agent.run', {
        surface: retrySurface, task: 'stopped', profile: 'test', key: 'retry-stopped', retry: true,
      }), 'effect-failed')
      return { exitCode: 0, signal: null, stdout: 'child-errors-covered', stderr: '' }
    }

    const parent = { id: 'child-errors-parent', session: { header: { id: 'child-errors-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', '# child errors', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: 'child-errors-covered' })
    expect(provider.authorityFailures).toEqual(Array.from({ length: 6 }, () => 'unauthorized'))
  })

  it('releases the child concurrency slot when preparation fails', async () => {
    const { service, provider } = await fixture()
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const failedSurface = await createAgentSurface(client, spec, 'prepare-failed')
      // The failure is injected after provisioning so the first agent.run that
      // must fail is the one whose projection preparation is rejected.
      const compile = vi.spyOn(service.projections, 'compile')
        .mockRejectedValueOnce(new WorkSurfaceError('effect-failed', 'projection preparation failed'))
      await expectCode(client.call('agent.run', {
        surface: failedSurface, task: 'valid', profile: 'test', key: 'prepare-failed',
      }), 'effect-failed')
      compile.mockRestore()

      const recoveredSurface = await createAgentSurface(client, spec, 'prepare-recovered')
      await client.call('agent.run', {
        surface: recoveredSurface, task: 'valid', profile: 'test', key: 'prepare-recovered',
      })
      return { exitCode: 0, signal: null, stdout: 'slot-released', stderr: '' }
    }

    const parent = { id: 'prepare-failure-parent', session: { header: { id: 'prepare-failure-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', '# prepare failure', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: 'slot-released' })
    expect(provider.starts).toBe(3)
  })

  it('contains lifecycle observer failures', async () => {
    const { ctx, service, provider } = await fixture()
    for (const event of [
      'worksurface/attempt-start',
      'worksurface/attempt-end',
      'worksurface/agent-start',
      'worksurface/agent-end',
    ] as const) {
      ctx.on(event, () => {
        throw new Error(`${event} observer failed`)
      })
    }
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const surface = await createAgentSurface(client, spec, 'observer-contained')
      await client.call('agent.run', {
        surface, task: 'valid', profile: 'test', key: 'observer-contained',
      })
      return { exitCode: 0, signal: null, stdout: 'observers-contained', stderr: '' }
    }

    const parent = { id: 'observer-parent', session: { header: { id: 'observer-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', '# observer failures', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: 'observers-contained' })
    expect(provider.starts).toBe(2)
  })

  it('enforces child concurrency and composes every optional profile field', async () => {
    const profiles: readonly WorkSurfaceProfile[] = [
      { name: 'plain', provider: 'fixture-provider', tokenBudget: 10_000, maxDepth: 3, maxParallel: 1 },
      {
        name: 'provider-only', provider: 'fixture-provider', tokenBudget: 10_000, maxDepth: 3, maxParallel: 1,
        toolAllow: ['safe_fixture'], agentProvider: 'fixture-route',
      },
      {
        name: 'model-only', provider: 'fixture-provider', tokenBudget: 10_000, maxDepth: 3, maxParallel: 1,
        agentModel: 'fixture-model',
      },
      {
        name: 'both', provider: 'fixture-provider', tokenBudget: 10_000, maxDepth: 3, maxParallel: 1,
        persona: 'Profile persona.', agentProvider: 'fixture-route', agentModel: 'fixture-model',
      },
    ]
    const { service, provider } = await fixture({ profiles })
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const firstSurface = await createAgentSurface(client, spec, 'parallel-first', 'plain')
      const secondSurface = await createAgentSurface(client, spec, 'parallel-second', 'plain')
      const first = client.call('agent.run', {
        surface: firstSurface, task: 'quiescence', profile: 'plain', key: 'parallel-first',
      })
      await provider.quiescenceReady
      await expectCode(client.call('agent.run', {
        surface: secondSurface, task: 'parallel-second', profile: 'plain', key: 'parallel-second',
      }), 'effect-failed')
      provider.releaseQuiescence()
      await first
      for (const profile of ['provider-only', 'model-only', 'both']) {
        const surface = await createAgentSurface(client, spec, `profile-${profile}`, 'plain')
        await client.call('agent.run', {
          surface, task: `valid-${profile}`, profile, key: `valid-${profile}`,
        })
      }
      return { exitCode: 0, signal: null, stdout: 'profiles-covered', stderr: '' }
    }

    const parent = { id: 'profiles-parent', session: { header: { id: 'profiles-parent' } } } as unknown as Agent
    await service.runOrchestrator(parent, 'bash', '# profiles', 'ws-root', new AbortController().signal)
    expect(provider.personas[0]).not.toContain('Profile persona.')
    expect(provider.requests.find(request => request.prompt[0]?.type === 'text'
      && request.prompt[0].text === 'valid-provider-only')?.toolFilter).toEqual({ allow: ['safe_fixture'] })
    expect(provider.requests.find(request => request.prompt[0]?.type === 'text'
      && request.prompt[0].text === 'valid-provider-only')?.agentOptions).toEqual({ provider: 'fixture-route' })
    expect(provider.requests.find(request => request.prompt[0]?.type === 'text'
      && request.prompt[0].text === 'valid-model-only')?.agentOptions).toEqual({ model: 'fixture-model' })
    expect(provider.requests.find(request => request.prompt[0]?.type === 'text'
      && request.prompt[0].text === 'valid-both')?.agentOptions).toEqual({
      provider: 'fixture-route', model: 'fixture-model',
    })
  })

  it('reconciles missing, completed, and corrupt child result records', async () => {
    const { service } = await fixture()
    ScriptedSubprocess.runner = async (spec) => {
      const client = orchestratorClient(spec)
      const attemptId = requiredEnv(spec.env?.WS_ATTEMPT_ID)
      const privateRoot = activeAttemptRoot(service, attemptId)
      const missingSurface = await createAgentSurface(client, spec, 'reconcile-missing')
      const completedSurface = await createAgentSurface(client, spec, 'reconcile-completed')
      const corruptSurface = await createAgentSurface(client, spec, 'reconcile-corrupt')
      const initial = await client.call('show', { surface: completedSurface }) as { revision: string }

      await writeStartedAgentRecord(service, attemptId, 'reconcile-missing', missingSurface, 'valid', 'test')
      await client.call('agent.run', {
        surface: missingSurface, task: 'valid', profile: 'test', key: 'reconcile-missing',
      })

      const completedKey = 'reconcile-completed'
      await writeStartedAgentRecord(service, attemptId, completedKey, completedSurface, 'reconciled', 'test')
      const completedRoot = join(privateRoot, 'runtime', 'agents', completedKey)
      await mkdir(completedRoot, { recursive: true })
      const reconciled = {
        surface: completedSurface, surfaceRevision: initial.revision, summary: 'reconciled',
        outputs: [{ surface: completedSurface, block: 'result', revision: initial.revision }],
      }
      await writeFile(join(completedRoot, 'result.json'), JSON.stringify(reconciled))
      await expect(client.call('agent.run', {
        surface: completedSurface, task: 'reconciled', profile: 'test', key: completedKey,
      })).resolves.toEqual(reconciled)

      const corruptKey = 'reconcile-corrupt'
      await writeStartedAgentRecord(service, attemptId, corruptKey, corruptSurface, 'corrupt', 'test')
      const corruptRoot = join(privateRoot, 'runtime', 'agents', corruptKey)
      await mkdir(corruptRoot, { recursive: true })
      await writeFile(join(corruptRoot, 'result.json'), '{')
      await expect(client.call('agent.run', {
        surface: corruptSurface, task: 'corrupt', profile: 'test', key: corruptKey,
      })).rejects.toBeDefined()
      return { exitCode: 0, signal: null, stdout: 'reconcile-covered', stderr: '' }
    }

    const parent = { id: 'reconcile-parent', session: { header: { id: 'reconcile-parent' } } } as unknown as Agent
    await expect(service.runOrchestrator(parent, 'bash', '# reconcile', 'ws-root', new AbortController().signal))
      .resolves.toMatchObject({ stdout: 'reconcile-covered' })
  })

  it('prunes attempts beyond the configured retention and archives their audit files', async () => {
    const root = await trackedRoot('worksurface-attempt-gc-')
    const template = join(root, 'root-template')
    await writeTemplate(template, 'File state B', 'ws-root')
    const store = new WorkSurfaceStore({ root })
    await store.newSurface({ attemptId: 'bootstrap', key: 'root', templatePath: template, surface: 'ws-root' })

    const attemptsRoot = join(root, 'attempts')
    await mkdir(attemptsRoot, { recursive: true })
    const now = Date.now()
    for (let index = 0; index < 5; index += 1) {
      const name = `attempt-old-${index}`
      const attemptRoot = join(attemptsRoot, name)
      await mkdir(join(attemptRoot, 'control'), { recursive: true })
      await mkdir(join(attemptRoot, 'runtime', 'agents'), { recursive: true })
      await mkdir(join(attemptRoot, 'work', 'root'), { recursive: true })
      await mkdir(join(attemptRoot, 'bin'), { recursive: true })
      await writeFile(join(attemptRoot, 'runtime', 'result.json'), JSON.stringify({ attemptId: name, index }))
      await writeFile(join(attemptRoot, 'control', 'main.sh'), `# ${index}`)
      await writeFile(join(attemptRoot, 'work', 'root', 'surface.md'), 'bulky checkout')
      const mtime = new Date(now - (5 - index) * 60_000)
      await utimes(attemptRoot, mtime, mtime)
    }

    const { ctx, provider } = await harnessContext(root)
    const fiber = await ctx.plugin(WorkSurfaceService, {
      root,
      attemptsRoot,
      socketPath: join(root, 'run', 'host.sock'),
      cliEntrypoint: join(process.cwd(), 'packages', 'cli', 'lib', 'bin.js'),
      attemptRetention: 2,
      profiles: pluginProfiles([{
        name: 'test',
        provider: provider.name,
        tokenBudget: 10_000,
        maxDepth: 3,
        maxParallel: 1,
        persona: 'Work only from files.',
      }]),
    })

    expect((await readdir(attemptsRoot)).sort()).toEqual(['attempt-old-3', 'attempt-old-4'])
    const archiveRoot = join(root, 'runtime', 'orchestrator', 'attempt-results')
    expect((await readdir(archiveRoot)).sort()).toEqual([
      'attempt-old-0.json',
      'attempt-old-1.json',
      'attempt-old-2.json',
    ])
    const archive = JSON.parse(await readFile(join(archiveRoot, 'attempt-old-0.json'), 'utf8')) as {
      result: { attemptId: string; index: number }
      control: { 'main.sh': string }
    }
    expect(archive.result).toMatchObject({ attemptId: 'attempt-old-0', index: 0 })
    expect(archive.control['main.sh']).toBe('# 0')
    await fiber.dispose()
  })

  it('archives expired unbound child Surfaces at startup without deleting their revisions', async () => {
    const root = await trackedRoot('worksurface-provisional-retention-')
    const template = join(root, 'root-template')
    await writeTemplate(template, 'File state B', 'ws-root')
    const store = new WorkSurfaceStore({ root })
    await store.newSurface({ attemptId: 'bootstrap', key: 'root', templatePath: template, surface: 'ws-root' })
    await store.newSurface({
      attemptId: 'bootstrap', key: 'provisional', templatePath: template,
      surface: 'ws-provisional', parent: 'ws-root',
    })
    await new Promise<void>(resolve => setTimeout(resolve, 5))

    const { ctx, provider } = await harnessContext(root)
    const fiber = await ctx.plugin(WorkSurfaceService, {
      root,
      attemptsRoot: join(root, 'attempts'),
      socketPath: join(root, 'run', 'host.sock'),
      cliEntrypoint: join(process.cwd(), 'packages', 'cli', 'lib', 'bin.js'),
      unboundSurfaceRetentionMs: 1,
      profiles: pluginProfiles([{
        name: 'test', provider: provider.name, tokenBudget: 10_000, maxDepth: 3, maxParallel: 1,
      }]),
    })

    await expect(ctx.workSurfaces.store.hasSurface('ws-provisional')).resolves.toBe(false)
    const archives = await readdir(join(root, 'canonical', 'orphans'))
    expect(archives.some(name => name.startsWith('ws-provisional-'))).toBe(true)
    const archived = archives.find(name => name.startsWith('ws-provisional-')) as string
    await expect(readFile(join(root, 'canonical', 'orphans', archived, 'HEAD.json'), 'utf8')).resolves.toContain('sha256:')
    await fiber.dispose()
  })

  it('validates configuration, profiles, persistent roots, and socket placement', async () => {
    const profile = {
      name: 'test', provider: 'fixture-provider', tokenBudget: 1000, maxDepth: 1, maxParallel: 1,
    }
    const invalidConfigs: Config[] = [
      { root: ' ', profiles: [profile] },
      { root: process.cwd(), orchestratorGraceMs: 0, profiles: [profile] },
      { root: process.cwd(), orchestratorGraceMs: 1.5, profiles: [profile] },
      { root: process.cwd(), maxOutputBytes: 0, profiles: [profile] },
      { root: process.cwd(), maxOutputBytes: 1.5, profiles: [profile] },
      { root: process.cwd(), maxCrashReplays: -1, profiles: [profile] },
      { root: process.cwd(), maxCrashReplays: 1.5, profiles: [profile] },
      { root: process.cwd(), attemptRetention: 0, profiles: [profile] },
      { root: process.cwd(), attemptRetention: 1.5, profiles: [profile] },
      { root: process.cwd(), unboundSurfaceRetentionMs: 0, profiles: [profile] },
      { root: process.cwd(), unboundSurfaceRetentionMs: 1.5, profiles: [profile] },
      { root: process.cwd(), profiles: [] },
      { root: process.cwd(), profiles: [{ ...profile, name: '' }] },
      { root: process.cwd(), profiles: [{ ...profile, provider: '' }] },
      { root: process.cwd(), profiles: [profile, profile] },
      { root: process.cwd(), profiles: [{ ...profile, tokenBudget: 0 }] },
      { root: process.cwd(), profiles: [{ ...profile, tokenBudget: 1.5 }] },
      { root: process.cwd(), profiles: [{ ...profile, maxDepth: -1 }] },
      { root: process.cwd(), profiles: [{ ...profile, maxDepth: 1.5 }] },
      { root: process.cwd(), profiles: [{ ...profile, maxParallel: 0 }] },
      { root: process.cwd(), profiles: [{ ...profile, maxParallel: 1.5 }] },
    ]
    for (const config of invalidConfigs) {
      const contextRoot = await trackedRoot('worksurface-invalid-config-')
      const { ctx } = await harnessContext(contextRoot)
      let failed = false
      try {
        new WorkSurfaceService(ctx, config)
      } catch {
        failed = true
      }
      expect(failed, JSON.stringify(config)).toBe(true)
    }

    const defaultsRoot = await trackedRoot('worksurface-default-config-')
    const defaultsHarness = await harnessContext(defaultsRoot)
    const defaultsFiber = await defaultsHarness.ctx.plugin(WorkSurfaceService, { root: defaultsRoot, profiles: [profile] })
    expect(defaultsHarness.ctx.workSurfaces.config).toMatchObject({
      attemptsRoot: join(defaultsRoot, 'runtime', 'orchestrator', 'runs'),
      socketPath: join(defaultsRoot, 'run', 'host.sock'),
      orchestratorGraceMs: 5000,
      maxOutputBytes: 1024 * 1024,
      maxCrashReplays: 1,
    })
    await defaultsFiber.dispose()

    const activationCases = [
      async () => ({ root: await trackedRoot('worksurface-socket-child-'), socket: 'child' }),
      async () => ({ root: await trackedRoot('worksurface-socket-same-'), socket: 'same' }),
      async () => ({ root: await trackedRoot('worksurface-socket-long-'), socket: 'long' }),
      async () => ({ root: await trackedRoot('worksurface-socket-temp-'), socket: 'temp' }),
      async () => ({ root: await trackedRoot('worksurface-socket-temp-root-'), socket: 'temp-root' }),
    ]
    for (const makeCase of activationCases) {
      const { root, socket } = await makeCase()
      const { ctx } = await harnessContext(root)
      const attemptsRoot = join(root, 'attempts')
      const socketPath = socket === 'child'
        ? join(attemptsRoot, 'host.sock')
        : socket === 'same'
          ? attemptsRoot
          : socket === 'long'
            ? join(root, 'x'.repeat(120))
            : socket === 'temp'
              ? join('/tmp', 'pf-worksurface-host.sock')
              : '/tmp'
      let rejected = false
      let resolvedSocket = ''
      try {
        const fiber = await ctx.plugin(WorkSurfaceService, { root, attemptsRoot, socketPath, profiles: [profile] })
        resolvedSocket = ctx.workSurfaces.config.socketPath
        await fiber.dispose()
      } catch {
        rejected = true
      }
      expect(rejected, `${socket}: ${resolvedSocket}`).toBe(true)
    }

    const temporaryRoot = join('/tmp', `pf-worksurface-root-${process.pid}`)
    roots.push(temporaryRoot)
    const temporaryHarness = await harnessContext(temporaryRoot)
    let temporaryRejected = false
    try {
      const fiber = await temporaryHarness.ctx.plugin(WorkSurfaceService, { root: temporaryRoot, profiles: [profile] })
      await fiber.dispose()
    } catch {
      temporaryRejected = true
    }
    expect(temporaryRejected, 'temporary root').toBe(true)

    const templateFailureRoot = await trackedRoot('worksurface-template-failure-')
    await mkdir(join(templateFailureRoot, 'runtime', 'templates', 'session-root'), { recursive: true })
    await writeFile(join(templateFailureRoot, 'runtime', 'templates', 'session-root', 'blocks'), 'not a directory')
    const templateFailureHarness = await harnessContext(templateFailureRoot)
    let templateRejected = false
    try {
      const fiber = await templateFailureHarness.ctx.plugin(WorkSurfaceService, { root: templateFailureRoot, profiles: [profile] })
      await fiber.dispose()
    } catch {
      templateRejected = true
    }
    expect(templateRejected, 'session template preparation').toBe(true)
  })
})

function orchestratorClient(spec: SubprocessSpawnSpec): WorkSurfaceHostClient {
  return new WorkSurfaceHostClient({
    socketPath: requiredEnv(spec.env?.WS_HOST_SOCKET),
    attemptId: requiredEnv(spec.env?.WS_ATTEMPT_ID),
    token: requiredEnv(spec.env?.WS_ATTEMPT_TOKEN),
  })
}

async function runLocalProcess(spec: SubprocessSpawnSpec): Promise<ScriptOutcome> {
  const [executable, ...argv] = spec.argv
  if (executable === undefined) throw new Error('real E2E subprocess requires an executable')
  return new Promise<ScriptOutcome>((resolve, reject) => {
    const child = spawnChild(executable, argv, {
      cwd: spec.cwd,
      env: { ...scrubbedParentEnv(), ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const abort = (): void => { child.kill('SIGTERM') }
    spec.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      spec.signal?.removeEventListener('abort', abort)
      resolve({ exitCode, signal, stdout, stderr })
    })
  })
}

async function createAgentSurface(client: WorkSurfaceHostClient, spec: SubprocessSpawnSpec, key: string, profile = 'test'): Promise<string> {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)
  const surface = `ws-agent-${slug}`
  const template = join(spec.cwd, `template-${slug}`)
  await writeTemplate(template, `Agent Surface ${slug}`, surface)
  // A delegated work unit is created by its delegation: provision it by running
  // a child that refuses to start, leaving the Surface materialized but unbound
  // so the test's own agent.run performs the real delegation.
  await expect(client.call('agent.run', {
    surface, task: 'start-failed', profile, key: `surface-${slug}`, templatePath: template, parent: 'ws-root',
  })).rejects.toMatchObject({ code: 'effect-failed' })
  await client.call('show', { surface })
  return surface
}

function b2fService(ctx: Context): FixtureB2FService {
  const service = (ctx as Context & { b2f?: FixtureB2FService }).b2f
  if (service === undefined) throw new Error('fixture b2f service is unavailable')
  return service
}

function activeAttemptRoot(service: WorkSurfaceService, attemptId: string): string {
  const attempts = (service as unknown as {
    attempts: ReadonlyMap<string, { root: string }>
  }).attempts
  const attempt = attempts.get(attemptId)
  if (attempt === undefined) throw new Error(`missing active attempt ${attemptId}`)
  return attempt.root
}

async function writeTemplate(path: string, body: string, surface: string): Promise<void> {
  await mkdir(join(path, 'blocks'), { recursive: true })
  await writeFile(join(path, 'surface.md'), `---\nstatus: active\n---\n${body}\n\n[[block:${surface}/result]]\n`)
  await writeFile(join(path, 'blocks', 'result.md'), '---\nblock_id: result\nsurface_id: template\nkind: result\nstatus: active\nderived_from: []\n---\nInitial B\n')
}

function requiredEnv(value: string | undefined): string {
  if (value === undefined || value === '') throw new Error('required fixture environment value is absent')
  return value
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toMatchObject({ code })
}

async function trackedRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '..', '..', prefix))
  roots.push(root)
  return root
}

async function writeStartedAgentRecord(
  service: WorkSurfaceService,
  attemptId: string,
  key: string,
  surface: string,
  task: string,
  profile: string,
): Promise<void> {
  const directory = join(service.store.runtimeRoot, 'orchestrator', 'agent-effects', attemptId)
  await mkdir(directory, { recursive: true })
  const requestHash = sha256(stableStringify({
    type: 'agent.run',
    request: { surface, task, profile, parent: 'ws-root', template: false },
  }))
  await writeFile(join(directory, `${sha256(key)}.json`), JSON.stringify({
    attemptId,
    key,
    type: 'agent.run',
    requestHash,
    status: 'started',
  }))
}
