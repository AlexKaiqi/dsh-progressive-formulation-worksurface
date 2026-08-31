import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { RevisionStore, sha256, stableStringify, WorkSurfaceError } from '@pf-worksurface/core'
import type { Revision } from '@pf-worksurface/core'
import { buildContextPlan, estimateTokens, foldInjectionState, foldLastRender, foldWorkSurfaceContext, selectActiveInjections } from './projections.ts'
import type {
  ContextContentRef,
  ContextInspection,
  ContextOccurrenceKind,
  ContextPlan,
  ContextProviderOccurrence,
  ContextProviderRegistration,
  ContextProviderResult,
  InjectionSection,
  ModelContextAdapter,
  ModelTarget,
  RenderBudget,
  RenderedContext,
  WorkSurfaceContextManifest,
} from './types.ts'
import './session-events.ts'

declare module '@deepseek-ai/cordis' { interface Context { contextProviders: ContextProviderRegistry } }

export interface ContextRuntimeHost {
  readonly revisions: RevisionStore
  readonly runtimeRoot: string
  readonly tokenBudget: () => number
}

export class ContextProviderRegistry extends Service {
  private readonly providers = new Map<string, ContextProviderRegistration>()

  constructor(ctx: Context) { super(ctx, 'contextProviders') }

  register(provider: ContextProviderRegistration): () => void {
    validateProvider(provider)
    if (this.providers.has(provider.providerId)) throw new TypeError(`duplicate context provider '${provider.providerId}'`)
    this.providers.set(provider.providerId, Object.freeze({ ...provider, phases: Object.freeze([...provider.phases]) }))
    return this.ctx.effect(() => () => { this.providers.delete(provider.providerId) }, `contextProviders.register(${provider.providerId})`)
  }

  forPhase(phase: ContextOccurrenceKind): readonly ContextProviderRegistration[] {
    return [...this.providers.values()].filter(provider => provider.phases.includes(phase)).sort((left, right) => left.order - right.order || left.providerId.localeCompare(right.providerId))
  }
}

/** Rebuilds model context exclusively from immutable revisions and Session facts. */
export class WorkSurfaceContextRuntime {
  readonly providers: ContextProviderRegistry
  readonly adapter: ModelContextAdapter
  private readonly blobRoot: string

  constructor(ctx: Context, readonly host: ContextRuntimeHost) {
    this.providers = new ContextProviderRegistry(ctx)
    this.blobRoot = join(host.runtimeRoot, 'context', 'blobs')
    this.adapter = new DefaultModelContextAdapter(this)
  }

  async publishRevision(agent: Agent, surfaceId: string, revision: Revision, previousRevision: Revision | null): Promise<WorkSurfaceContextManifest> {
    const stored = await this.host.revisions.read(revision)
    if (stored.kind !== 'surface') throw new WorkSurfaceError('invalid-working-copy', `revision '${revision}' is not a Surface revision`)
    const files = stored.entries.map(entry => ({
      kind: 'worksurface-file' as const,
      surfaceId,
      revision,
      path: entry.path,
      contentHash: `sha256:${entry.sha256}` as Revision,
      size: entry.size,
    }))
    const canonical = { surfaceId, revision, files }
    const manifest: WorkSurfaceContextManifest = { ...canonical, manifestHash: digest(stableStringify(canonical)) }
    const current = foldWorkSurfaceContext(agent.session.events)
    if (current.surfaceId === surfaceId && current.revision === revision && current.manifestHash === manifest.manifestHash) return manifest
    appendFact(agent.session, 'worksurface/context-revision', {
      surfaceId,
      revision,
      previousRevision: previousRevision ?? (current.surfaceId === surfaceId ? current.revision : null),
      manifest,
    })
    return manifest
  }

  async prepareAutomaticOccurrences(agent: Agent, signal?: AbortSignal): Promise<void> {
    const workSurface = foldWorkSurfaceContext(agent.session.events)
    this.endExpiredOccurrences(agent, workSurface.revision)
    const target = {
      ...(workSurface.surfaceId === null ? {} : { surfaceId: workSurface.surfaceId }),
      ...(workSurface.revision === null ? {} : { revision: workSurface.revision }),
    }
    if (this.providers.forPhase('analysis').length > 0) {
      const phaseOccurrenceId = `analysis:${workSurface.revision ?? 'none'}`
      this.endSupersededPhase(agent, 'analysis', phaseOccurrenceId)
      await this.createOccurrence(agent, { kind: 'analysis', phaseOccurrenceId, ...target }, { kind: 'phase' }, signal)
    }
    if (workSurface.revision !== null && this.providers.forPhase('acceptance').length > 0) {
      await this.createOccurrence(agent, { kind: 'acceptance', phaseOccurrenceId: `acceptance:${workSurface.revision}`, ...target }, { kind: 'until-revision-change', revision: workSurface.revision }, signal)
    }
    if (agent.session.firstLiveSeq > 0 && this.providers.forPhase('recovery').length > 0) {
      await this.createOccurrence(agent, { kind: 'recovery', phaseOccurrenceId: `recovery:${agent.session.firstLiveSeq}:${workSurface.revision ?? 'none'}`, ...target }, { kind: 'request' }, signal)
    }
    const maintenance = maintenanceTrigger(agent, workSurface.revision, this.host.tokenBudget())
    if (maintenance !== null && this.providers.forPhase('maintenance').length > 0) {
      await this.createOccurrence(agent, { kind: 'maintenance', phaseOccurrenceId: maintenance, ...target }, { kind: 'request' }, signal)
    }
  }

  async createOccurrence(
    agent: Agent,
    target: { kind: ContextOccurrenceKind; surfaceId?: string; revision?: Revision; requestOccurrenceId?: string; phaseOccurrenceId?: string },
    lifetime: ContextProviderOccurrence['lifetime'],
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted()
    const canonicalTarget = {
      sessionId: String(agent.session.id),
      ...(target.surfaceId === undefined ? {} : { surfaceId: target.surfaceId }),
      ...(target.revision === undefined ? {} : { revision: target.revision }),
      ...(target.requestOccurrenceId === undefined ? {} : { requestOccurrenceId: target.requestOccurrenceId }),
      ...(target.phaseOccurrenceId === undefined ? {} : { phaseOccurrenceId: target.phaseOccurrenceId }),
    }
    const occurrenceId = `ctx-${sha256(stableStringify({ kind: target.kind, target: canonicalTarget, lifetime })).slice(0, 24)}`
    const providers = this.providers.forPhase(target.kind)
    const replay = foldInjectionState(agent.session.events).occurrences.find(item => item.occurrenceId === occurrenceId)
    if (replay !== undefined && replay.status !== 'collecting') {
      assertRequiredProviders(providers, replay.failures)
      return occurrenceId
    }
    if (replay === undefined) appendFact(agent.session, 'context/occurrence-created', { occurrenceId, kind: target.kind, target: canonicalTarget, lifetime })
    const occurrence = { occurrenceId, kind: target.kind, target: canonicalTarget, lifetime }
    const settledIds = new Set(agent.session.events.flatMap(event => event.type === 'context/provider-settled' && (event.data as { occurrenceId: string }).occurrenceId === occurrenceId ? [(event.data as { providerId: string }).providerId] : []))
    const pending = providers.filter(provider => !settledIds.has(provider.providerId))
    if (providers.length === 0) {
      if (!settledIds.has('runtime:none')) appendFact(agent.session, 'context/provider-settled', { occurrenceId, providerId: 'runtime:none', result: { kind: 'no-contribution' }, ready: true })
    } else if (pending.length === 0) {
      appendFact(agent.session, 'context/provider-settled', { occurrenceId, providerId: 'runtime:resume', result: { kind: 'no-contribution' }, ready: true })
    } else {
      const results = await Promise.all(pending.map(provider => this.callProvider(provider, occurrence, signal)))
      for (const [index, provider] of pending.entries()) {
        let normalized: Awaited<ReturnType<WorkSurfaceContextRuntime['persistProviderResult']>>
        try { normalized = await this.persistProviderResult(provider.providerId, results[index]!) }
        catch { normalized = { kind: 'failed', errorCode: 'invalid-contribution', retryable: false } }
        appendFact(agent.session, 'context/provider-settled', { occurrenceId, providerId: provider.providerId, result: normalized, ready: index === pending.length - 1 })
      }
    }
    const settled = foldInjectionState(agent.session.events).occurrences.find(item => item.occurrenceId === occurrenceId)
    assertRequiredProviders(providers, settled?.failures ?? [])
    return occurrenceId
  }

  async render(agent: Agent, target: ModelTarget, budget?: Partial<RenderBudget>): Promise<RenderedContext> {
    const plan = buildContextPlan(agent)
    return this.adapter.render(agent, plan, target, { maxInputTokens: budget?.maxInputTokens ?? target.contextWindow ?? Number.MAX_SAFE_INTEGER })
  }

  recordRender(agent: Agent, rendered: RenderedContext): void {
    appendFact(agent.session, 'context/rendered', { manifest: rendered.manifest })
    const state = foldInjectionState(agent.session.events)
    for (const occurrenceId of buildContextPlan(agent).sources.injectionOccurrenceIds) {
      const occurrence = state.occurrences.find(candidate => candidate.occurrenceId === occurrenceId)
      if (occurrence?.status !== 'ready') continue
      const prefix = `injection:${occurrenceId}:`
      if (occurrence.sections.length > 0 && !rendered.manifest.includedItems.some(item => item.startsWith(prefix))) continue
      appendFact(agent.session, 'context/occurrence-consumed', { occurrenceId, planId: rendered.manifest.planId })
      if (occurrence.lifetime.kind === 'request') appendFact(agent.session, 'context/occurrence-ended', { occurrenceId, reason: 'request-consumed' })
    }
  }

  inspect(agent: Agent): ContextInspection {
    const plan = buildContextPlan(agent)
    return {
      sessionId: String(agent.session.id),
      asOfSeq: agent.session.seq - 1,
      surfaceGeneration: agent.session.surface.replaceGeneration,
      surfaceNodes: agent.session.surface.nodes.map((seq, position) => ({ position, seq, type: agent.session.events[seq]?.type ?? 'missing', estimatedTokens: estimateTokens(stableStringify(agent.session.events[seq]?.data ?? null)) })),
      workSurface: foldWorkSurfaceContext(agent.session.events),
      activeInjections: selectActiveInjections(agent.session.events),
      plan,
      lastRender: foldLastRender(agent.session.events),
    }
  }

  async resolve(ref: ContextContentRef): Promise<string> {
    assertDigest(ref.contentHash)
    if (ref.kind === 'blob') {
      const content = await readFile(join(this.blobRoot, `${ref.contentHash.slice(7)}.txt`), 'utf8')
      assertContent(content, ref.contentHash)
      return content
    }
    if (ref.kind === 'worksurface-file') {
      const content = (await this.host.revisions.readFile(ref.revision, ref.path)).toString('utf8')
      assertContent(content, ref.contentHash)
      return content
    }
    throw new WorkSurfaceError('invalid-working-copy', 'Session event content is resolved by the Session projection')
  }

  private async callProvider(provider: ContextProviderRegistration, occurrence: ContextProviderOccurrence, parentSignal?: AbortSignal): Promise<ContextProviderResult> {
    const controller = new AbortController()
    let timedOut = false
    const abort = (): void => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error(`context provider timed out after ${provider.timeoutMs}ms`)) }, provider.timeoutMs)
    try {
      return await Promise.race([provider.provide(occurrence, controller.signal), new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))])
    } catch {
      if (parentSignal?.aborted) throw parentSignal.reason
      return { kind: 'failed', errorCode: timedOut ? 'timeout' : 'provider-error', retryable: true }
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }
  }

  private async persistProviderResult(providerId: string, result: ContextProviderResult): Promise<{ readonly kind: 'no-contribution' } | { readonly kind: 'failed'; readonly errorCode: string; readonly retryable: boolean } | { readonly kind: 'contribution'; readonly sections: readonly InjectionSection[] }> {
    if (result.kind !== 'contribution') return result
    const sections: InjectionSection[] = []
    for (const section of result.sections) {
      if ((section.content === undefined) === (section.contentRef === undefined)) throw new TypeError(`provider '${providerId}' section '${section.sectionId}' must supply exactly one source`)
      let contentRef = section.contentRef
      let contentHash = section.contentHash
      if (section.content !== undefined) {
        contentHash = digest(section.content)
        contentRef = { kind: 'blob', id: contentHash, contentHash }
        await mkdir(this.blobRoot, { recursive: true, mode: 0o700 })
        try { await writeFile(join(this.blobRoot, `${contentHash.slice(7)}.txt`), section.content, { flag: 'wx', mode: 0o600 }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        assertContent(await readFile(join(this.blobRoot, `${contentHash.slice(7)}.txt`), 'utf8'), contentHash)
      }
      if (contentRef === undefined) throw new TypeError('provider content reference is missing')
      contentHash ??= contentRef.contentHash
      if (contentHash !== contentRef.contentHash) throw new TypeError(`provider '${providerId}' section hash disagrees with its reference`)
      sections.push({ sectionId: section.sectionId, providerId, contentRef, contentHash, sourceVersion: section.sourceVersion, priority: section.priority })
    }
    return { kind: 'contribution', sections }
  }

  private endExpiredOccurrences(agent: Agent, revision: Revision | null): void {
    for (const occurrence of foldInjectionState(agent.session.events).occurrences) {
      if (occurrence.status === 'ended' || occurrence.status === 'collecting') continue
      if (occurrence.lifetime.kind === 'until-revision-change' && occurrence.lifetime.revision !== revision) {
        appendFact(agent.session, 'context/occurrence-ended', { occurrenceId: occurrence.occurrenceId, reason: 'revision-changed' })
      } else if (occurrence.lifetime.kind === 'until-event') {
        const eventType = occurrence.lifetime.eventType
        const created = agent.session.events.find(event => event.type === 'context/occurrence-created' && (event.data as { occurrenceId?: string }).occurrenceId === occurrence.occurrenceId)
        if (agent.session.events.some(event => event.seq > (created?.seq ?? -1) && event.type === eventType)) appendFact(agent.session, 'context/occurrence-ended', { occurrenceId: occurrence.occurrenceId, reason: `event:${eventType}` })
      }
    }
  }

  private endSupersededPhase(agent: Agent, kind: ContextOccurrenceKind, phaseOccurrenceId: string): void {
    for (const occurrence of foldInjectionState(agent.session.events).occurrences) {
      if (occurrence.kind === kind && occurrence.lifetime.kind === 'phase' && occurrence.status !== 'ended' && occurrence.status !== 'collecting' && occurrence.target.phaseOccurrenceId !== phaseOccurrenceId) {
        appendFact(agent.session, 'context/occurrence-ended', { occurrenceId: occurrence.occurrenceId, reason: 'phase-superseded' })
      }
    }
  }
}

class DefaultModelContextAdapter implements ModelContextAdapter {
  readonly id = 'dsh-default'
  readonly version = 1
  constructor(private readonly runtime: WorkSurfaceContextRuntime) {}
  supports(): boolean { return true }

  async render(agent: Agent, plan: ContextPlan, target: ModelTarget, budget: RenderBudget): Promise<RenderedContext> {
    if (!Number.isSafeInteger(budget.maxInputTokens) || budget.maxInputTokens <= 0) throw new WorkSurfaceError('invalid-working-copy', 'render token budget must be a positive safe integer')
    const tokens = new Map<string, number>()
    const text = new Map<string, string>()
    for (const item of plan.items) {
      if (item.contentRef.kind === 'session-event') { tokens.set(item.itemId, item.estimatedTokens ?? 0); continue }
      const resolved = await this.runtime.resolve(item.contentRef)
      text.set(item.itemId, resolved)
      tokens.set(item.itemId, estimateTokens(resolved))
    }
    const required = plan.items.filter(item => item.priority === 'required' || item.omissionPolicy === 'never')
    const requiredTokens = required.reduce((sum, item) => sum + (tokens.get(item.itemId) ?? 0), 0)
    if (requiredTokens > budget.maxInputTokens) throw new WorkSurfaceError('effect-failed', `required context needs approximately ${requiredTokens} tokens, exceeding budget ${budget.maxInputTokens}`)
    const included = new Set(required.map(item => item.itemId))
    let used = requiredTokens
    for (const priority of ['high', 'normal', 'low'] as const) for (const item of plan.items) {
      if (included.has(item.itemId) || item.priority !== priority) continue
      const count = tokens.get(item.itemId) ?? 0
      if (used + count <= budget.maxInputTokens) { included.add(item.itemId); used += count }
    }
    const contexts = plan.items.filter(item => included.has(item.itemId) && item.contentRef.kind !== 'session-event').map(item => ({ name: item.itemId, text: text.get(item.itemId) ?? '' }))
    const manifestBase = {
      adapterId: this.id,
      adapterVersion: this.version,
      planId: plan.planId,
      asOfSeq: plan.asOfSeq,
      includedItems: plan.items.filter(item => included.has(item.itemId)).map(item => item.itemId),
      omittedItems: plan.items.filter(item => !included.has(item.itemId)).map(item => ({ itemId: item.itemId, reason: 'token-budget' as const })),
      estimatedTokens: used,
      target,
    }
    const messages = agent.session.deriveMessages()
    return { contexts, messages, manifest: { ...manifestBase, contentHash: digest(stableStringify({ manifest: manifestBase, contexts, messages })) } }
  }
}

type ContextFactType =
  | 'worksurface/context-revision'
  | 'context/occurrence-created'
  | 'context/provider-settled'
  | 'context/occurrence-consumed'
  | 'context/occurrence-ended'
  | 'context/rendered'

function appendFact(session: Session, type: ContextFactType, data: SessionEventMap[ContextFactType]): void {
  session.append(type, data, { ignorable: true })
}

function maintenanceTrigger(agent: Agent, revision: Revision | null, tokenBudget: number): string | null {
  const total = agent.session.surface.nodes.reduce((sum, seq) => sum + estimateTokens(stableStringify(agent.session.events[seq]?.data ?? null)), 0)
  const largeTool = agent.session.surface.nodes.findLast(seq => agent.session.events[seq]?.type === 'tool/result' && estimateTokens(stableStringify(agent.session.events[seq]?.data ?? null)) > Math.max(1_000, Math.floor(tokenBudget / 4)))
  if (total >= Math.floor(tokenBudget * 0.8)) return `pressure:${agent.session.surface.replaceGeneration}`
  if (largeTool !== undefined) return `tool-result:${largeTool}`
  const previous = agent.session.events.filter(event => event.type === 'worksurface/context-revision').at(-2) as { data?: { revision?: Revision } } | undefined
  if (previous?.data?.revision !== undefined && previous.data.revision !== revision) return `revision:${revision}`
  return null
}

function validateProvider(provider: ContextProviderRegistration): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider.providerId)) throw new TypeError('context providerId is invalid')
  if (!Number.isFinite(provider.order)) throw new TypeError('context provider order must be finite')
  if (!Number.isSafeInteger(provider.timeoutMs) || provider.timeoutMs <= 0) throw new TypeError('context provider timeoutMs must be a positive safe integer')
  if (provider.phases.length === 0) throw new TypeError('context provider must select at least one phase')
}

function assertRequiredProviders(providers: readonly ContextProviderRegistration[], failures: readonly { providerId: string; errorCode: string }[]): void {
  const required = new Set(providers.filter(provider => provider.required).map(provider => provider.providerId))
  const failed = failures.filter(item => required.has(item.providerId)).map(item => `${item.providerId}: ${item.errorCode}`)
  if (failed.length > 0) throw new WorkSurfaceError('effect-failed', `required context provider failure: ${failed.join(', ')}`)
}

function digest(value: string): Revision { return `sha256:${sha256(value)}` }
function assertDigest(value: Revision): void { if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new WorkSurfaceError('invalid-working-copy', `invalid context hash '${value}'`) }
function assertContent(content: string, expected: Revision): void { if (digest(content) !== expected) throw new WorkSurfaceError('canonical-corrupt', `context content does not match ${expected}`) }
