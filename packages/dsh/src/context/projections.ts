import type { Agent } from '@deepseek-ai/dsh-agent'
import { sha256, stableStringify } from '@pf-worksurface/core'
import type { Revision } from '@pf-worksurface/core'
import type { ContextItem, ContextPlan, InjectionOccurrence, InjectionState, RenderManifest, WorkSurfaceContextState } from './types.ts'

type SessionEvent = Agent['session']['events'][number]

export function foldWorkSurfaceContext(events: readonly SessionEvent[]): WorkSurfaceContextState {
  let state: WorkSurfaceContextState = { surfaceId: null, revision: null, manifestHash: null, files: [] }
  for (const event of events) {
    if (event.type !== 'worksurface/context-revision') continue
    const data = event.data as { surfaceId: string; revision: Revision; manifest: { manifestHash: Revision; files: WorkSurfaceContextState['files'] } }
    state = { surfaceId: data.surfaceId, revision: data.revision, manifestHash: data.manifest.manifestHash, files: data.manifest.files }
  }
  return state
}

export function foldInjectionState(events: readonly SessionEvent[]): InjectionState {
  const occurrences = new Map<string, InjectionOccurrence>()
  for (const event of events) {
    if (event.type === 'context/occurrence-created') {
      const data = event.data as Omit<InjectionOccurrence, 'status' | 'sections' | 'failures'>
      occurrences.set(data.occurrenceId, { ...data, status: 'collecting', sections: [], failures: [] })
      continue
    }
    if (event.type === 'context/provider-settled') {
      const data = event.data as { occurrenceId: string; providerId: string; result: { kind: 'no-contribution' } | { kind: 'contribution'; sections: InjectionOccurrence['sections'] } | { kind: 'failed'; errorCode: string; retryable: boolean }; ready: boolean }
      const current = occurrences.get(data.occurrenceId)
      if (current === undefined) continue
      const sections = data.result.kind === 'contribution' ? [...current.sections, ...data.result.sections] : current.sections
      const failures = data.result.kind === 'failed' ? [...current.failures, { providerId: data.providerId, errorCode: data.result.errorCode, retryable: data.result.retryable }] : current.failures
      occurrences.set(data.occurrenceId, { ...current, sections, failures, status: data.ready ? 'ready' : current.status })
      continue
    }
    if (event.type === 'context/occurrence-consumed' || event.type === 'context/occurrence-ended') {
      const current = occurrences.get((event.data as { occurrenceId: string }).occurrenceId)
      if (current !== undefined) occurrences.set(current.occurrenceId, { ...current, status: event.type === 'context/occurrence-consumed' ? 'consumed' : 'ended' })
    }
  }
  return { occurrences: [...occurrences.values()] }
}

export function buildContextPlan(agent: Agent): ContextPlan {
  const { session } = agent
  const events = session.events
  const workSurface = foldWorkSurfaceContext(events)
  const items: ContextItem[] = []
  for (const seq of session.surface.nodes) {
    const event = events[seq]
    if (event === undefined) continue
    const checkpoint = event.type === 'user/message' && (event.data as { source?: { kind?: string } }).source?.kind === 'compaction'
    items.push({
      itemId: `conversation:${seq}`,
      kind: checkpoint ? 'compaction-checkpoint' : 'conversation-message',
      contentRef: { kind: 'session-event', sessionId: String(session.id), seq, contentHash: digest(stableStringify(event.data)) },
      sourceFactSeqs: [seq],
      priority: checkpoint ? 'high' : 'normal',
      omissionPolicy: 'never',
      lifetime: { kind: 'session' },
      estimatedTokens: estimateTokens(stableStringify(event.data)),
    })
  }

  const revisionFact = findLastEventSeq(events, 'worksurface/context-revision')
  for (const file of workSurface.files) {
    items.push({
      itemId: `surface-file:${file.path}:${file.contentHash}`,
      kind: 'surface-file',
      contentRef: file,
      sourceFactSeqs: revisionFact === null ? [] : [revisionFact],
      priority: file.path === 'surface.md' ? 'required' : 'high',
      omissionPolicy: file.path === 'surface.md' ? 'never' : 'whole-item',
      lifetime: { kind: 'until-revision-change', revision: file.revision },
      estimatedTokens: Math.max(1, Math.ceil(file.size / 4)),
    })
  }

  const active = selectActiveInjections(events, foldInjectionState(events), workSurface)
  for (const occurrence of active) {
    for (const section of occurrence.sections) {
      items.push({
        itemId: `injection:${occurrence.occurrenceId}:${section.providerId}:${section.sectionId}`,
        kind: occurrence.kind === 'recovery' ? 'recovery-state' : 'runtime-injection',
        contentRef: section.contentRef,
        sourceFactSeqs: eventSeqsForOccurrence(events, occurrence.occurrenceId),
        priority: section.priority,
        omissionPolicy: section.priority === 'required' ? 'never' : 'whole-item',
        lifetime: occurrence.lifetime,
      })
    }
  }

  const canonical = {
    version: 1 as const,
    sessionId: String(session.id),
    asOfSeq: session.seq - 1,
    sources: {
      conversationGeneration: session.surface.replaceGeneration,
      workSurfaceRevision: workSurface.revision,
      workSurfaceManifestHash: workSurface.manifestHash,
      injectionOccurrenceIds: active.map(item => item.occurrenceId),
    },
    items,
  }
  return { ...canonical, planId: digest(stableStringify(canonical)) }
}

export function selectActiveInjections(events: readonly SessionEvent[], state = foldInjectionState(events), workSurface = foldWorkSurfaceContext(events)): readonly InjectionOccurrence[] {
  return state.occurrences.filter(occurrence => {
    if (occurrence.status === 'collecting' || occurrence.status === 'ended') return false
    if (occurrence.lifetime.kind === 'request') return occurrence.status === 'ready'
    if (occurrence.lifetime.kind === 'until-revision-change') return occurrence.lifetime.revision === workSurface.revision
    if (occurrence.lifetime.kind === 'until-event') {
      const eventType = occurrence.lifetime.eventType
      const created = events.find(event => event.type === 'context/occurrence-created' && (event.data as { occurrenceId?: string }).occurrenceId === occurrence.occurrenceId)
      return !events.some(event => event.seq > (created?.seq ?? -1) && event.type === eventType)
    }
    return true
  })
}

export function foldLastRender(events: readonly SessionEvent[]): RenderManifest | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'context/rendered') return (event.data as { manifest: RenderManifest }).manifest
  }
  return null
}

export function estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)) }

function findLastEventSeq(events: readonly SessionEvent[], type: string): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) if (events[index]?.type === type) return index
  return null
}

function eventSeqsForOccurrence(events: readonly SessionEvent[], occurrenceId: string): number[] {
  return events.filter(event => event.type.startsWith('context/') && (event.data as { occurrenceId?: string }).occurrenceId === occurrenceId).map(event => event.seq)
}

function digest(value: string): Revision { return `sha256:${sha256(value)}` }
