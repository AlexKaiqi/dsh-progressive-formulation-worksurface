// Invariant assertions: [WS-20] [WS-25] [WS-26]
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SURFACE_TEMPLATE, type Revision } from '@pf-worksurface/core'
import { afterEach, describe, expect, it } from 'vitest'
import { helpFor } from '../../cli/src/help.ts'
import { WorkSurfaceService } from '../src/service.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))) })

// The model port holds real DSH Turns open while a deterministic consumer writes
// files and invokes the shipped CLI. This is a protocol consumer test, not a
// claim that a real model can complete the WS-M3 acceptance scenario.
class WaitingModel extends LlmAdapter {
  requests = 0
  private waiting: (() => void)[] = []
  private released = false
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id: model, name: model }) }
  release() { this.released = true; for (const release of this.waiting.splice(0)) release() }
  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (!this.released) await new Promise<void>(resolve => this.waiting.push(resolve))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'consumer complete' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'consumer complete' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('active Surface file publication through the public CLI', () => {
  it('publishes newly written files before the help example consumes them and permits a final publication with no business outputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-publication-cli-')); roots.push(root)
    const work = join(root, 'work'), authoring = join(work, 'orchestrations/research-to-report'), artifact = join(authoring, 'artifact')
    await mkdir(join(artifact, 'contracts'), { recursive: true })
    const help = helpFor('coordinate')
    const section = (start: string, end: string): string => help.split(`${start}\n`)[1]!.split(`\n\n${end}`)[0]!
    await writeFile(join(authoring, 'registration.json'), section('registration.json:', 'artifact/contracts/research.ready.json:'))
    await writeFile(join(artifact, 'contracts/research.ready.json'), section('artifact/contracts/research.ready.json:', 'artifact/orchestrate.py:'))
    await writeFile(join(artifact, 'orchestrate.py'), section('artifact/orchestrate.py:', 'RUN VIEW AND OUTPUT RULES'))
    for (const surface of ['research', 'report']) {
      await mkdir(join(work, 'surfaces', surface), { recursive: true })
      await writeFile(join(work, 'surfaces', surface, 'surface.md'), SURFACE_TEMPLATE)
    }
    const socketPath = join(root, 'host.sock')
    const ctx = new Context(), model = new WaitingModel()
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjection)
    await ctx.plugin(SystemPrompt, { persona: 'Protocol consumer test.' }); await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentDefaultModel, { provider: 'consumer', model: 'waiting' })
    await ctx.plugin(ShellEnvPlugin, { dshHome: join(root, 'dsh-home') })
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    ctx.provide('workspaceRegistry', { create: async () => ({ id: 'consumer-workspace', attachSession: async () => undefined }) } as never)
    // Real Python executes the exact CLI example and reads the runtime-built
    // staged view. Native OS confinement is a separate host acceptance boundary.
    ctx.provide('sandbox', { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) } as never)
    ctx.provide('subprocess', {
      resolveExecutable: async () => { const child = localProcess(['/usr/bin/which', 'python3'], root); expect((await child.done).exitCode).toBe(0); return child.collected.stdout.readFrom().text.trim() },
      spawn: ({ argv, cwd, signal }: { argv: string[]; cwd: string; signal: AbortSignal }) => localProcess(argv, cwd, signal),
    } as never)
    ctx.llm.registerAdapter(['consumer'], model)
    try {
      await ctx.plugin(WorkSurfaceService, { root: join(root, 'state'), workRoot: work, socketPath })
      const service = ctx.workSurfaces
      const ordinary = { DSH_WORKSURFACE_SOCKET: socketPath }
      await cli(['sync'], ordinary)
      const initial = (await cli(['list'], ordinary) as { surfaceId: string; revision: Revision }[]).find(s => s.surfaceId === 'research')!.revision
      await expect(service.revisions.readFile(initial, 'findings.md')).rejects.toThrow()
      const started = await cli(['run', 'research', '--instruction', 'Prepare findings.', '--key', 'research-first'], ordinary) as { sessionId: string }
      await expect.poll(() => service.surfaces.activeSurface(started.sessionId)?.viewDir).toBeDefined()
      await expect.poll(() => model.requests).toBe(1)
      const sourceAgent = ctx.agents.get(SessionId(started.sessionId))!
      const sourceEnv = ctx.shellEnv.collect({ agent: sourceAgent } as never)
      const sourceBrief = JSON.parse(await readFile(join(sourceEnv.DSH_WORKSURFACE_VIEW_DIR!, 'turn-brief.json'), 'utf8'))
      expect(sourceBrief.filePublication.command.argv.slice(1)).toEqual(['publish', '--key', '<stable-publication-key>'])
      expect(sourceBrief.outputs.map((o: { name: string }) => o.name)).toEqual(['research.ready'])
      const findings = 'Measured 360 July orders and 400 August orders. Source: fixed input.\n'
      await writeFile(join(sourceEnv.DSH_SURFACE_DIR!, 'findings.md'), findings)
      expect((await cli(['list'], ordinary) as { surfaceId: string; revision: Revision }[]).find(s => s.surfaceId === 'research')!.revision).toBe(initial)
      const publicationArgv = sourceBrief.filePublication.command.argv.slice(1).map((arg: string) => arg === '<stable-publication-key>' ? 'findings-v1' : arg)
      const published = await cli([...publicationArgv, '--summary', 'Reviewed findings'], sourceEnv)
      const head = (await cli(['list'], ordinary) as { surfaceId: string; revision: Revision }[]).find(s => s.surfaceId === 'research')!.revision
      expect(head).not.toBe(initial)
      expect((await service.revisions.readFile(head, 'findings.md')).toString()).toBe(findings)
      expect(await cli(['publish', '--key', 'findings-v1', '--summary', 'Reviewed findings'], sourceEnv)).toEqual(published)
      expect(service.surfaces.bindingForSurface('report')).toBeUndefined()
      await cli(['emit', 'research.ready', '--payload', JSON.stringify({ summary: 'Findings independently checked.' })], sourceEnv)
      await expect.poll(() => service.surfaces.bindingForSurface('report')?.sessionId, { timeout: 5000 }).toBeDefined()
      const targetId = service.surfaces.bindingForSurface('report')!.sessionId
      await expect.poll(() => service.surfaces.activeSurface(targetId)?.viewDir).toBeDefined()
      // Turn start establishes the scope; admitted user/message installs the
      // specific Brief before the real model request begins. Observe the
      // consumer boundary, not the earlier transient Turn-start projection.
      await expect.poll(() => model.requests).toBe(2)
      const targetAgent = ctx.agents.get(SessionId(targetId))!
      const targetEnv = ctx.shellEnv.collect({ agent: targetAgent } as never)
      expect(await readFile(join(targetEnv.DSH_SURFACE_DIR!, 'research.md'), 'utf8')).toBe(findings)
      const targetBrief = JSON.parse(await readFile(join(targetEnv.DSH_WORKSURFACE_VIEW_DIR!, 'turn-brief.json'), 'utf8'))
      expect(targetBrief.outputs).toEqual([])
      expect(targetBrief.filePublication.command.argv[1]).toBe('publish')
      expect(targetBrief.instruction).toContain('Read research.md and surface.md')
      await writeFile(join(targetEnv.DSH_SURFACE_DIR!, 'report-draft.md'), 'Preserved draft.\n')
      await writeFile(join(targetEnv.DSH_SURFACE_DIR!, 'report.md'), '360 -> 400: +40 orders, +11.11%.\n')
      await cli(['publish', '--key', 'report-v1'], targetEnv)
      const targetHead = (await cli(['list'], ordinary) as { surfaceId: string; revision: Revision }[]).find(s => s.surfaceId === 'report')!.revision
      expect((await service.revisions.readFile(targetHead, 'report.md')).toString()).toContain('+11.11%')
      expect((await service.revisions.readFile(targetHead, 'report-draft.md')).toString()).toBe('Preserved draft.\n')
      const inspect = await cli(['recover'], ordinary) as { runtime: { failedRegistrations: unknown[] } }
      expect(inspect.runtime.failedRegistrations).toEqual([])
    } finally { model.release(); await ctx.fiber.dispose() }
  }, 20_000)
})

async function cli(argv: string[], injected: Record<string, string>): Promise<unknown> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../cli/lib/bin.js', import.meta.url)), ...argv], { env: { PATH: process.env.PATH, ...injected }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk }); child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  if (code !== 0) throw new Error(`CLI ${argv[0]} failed (${code}): ${stderr}`)
  return JSON.parse(stdout)
}

function localProcess(argv: string[], cwd: string, signal?: AbortSignal) {
  const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], signal })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk }); child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  return {
    done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })) }),
    collected: { stdout: { readFrom: () => ({ text: stdout, lossy: false }) }, stderr: { readFrom: () => ({ text: stderr, lossy: false }) } },
  }
}
