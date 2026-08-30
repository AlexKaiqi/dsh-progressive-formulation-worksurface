import { WorkSurfaceError } from './error.ts'
import type { EventRef, WorkSurfaceEvent } from './event-model.ts'

export type SurfaceDisplayPhase = 'idle' | 'published' | 'waiting-user' | 'completed' | 'failed' | 'conflicted'
export type ViewInterpretationDisplay = 'verified' | 'completed' | 'failed' | 'waiting-user'

export interface WorkSurfaceViewDefinition {
  readonly version: 1
  readonly title?: string
  readonly surfaces?: Readonly<Record<string, {
    readonly title: string
    readonly titleLocked?: boolean
    readonly group?: string
  }>>
  readonly orchestrations?: Readonly<Record<string, {
    readonly title: string
    readonly subscriptions?: Readonly<Record<string, { readonly title: string }>>
  }>>
  readonly interpretations?: readonly {
    readonly event: string
    readonly display: ViewInterpretationDisplay
    readonly surface?: string
  }[]
  readonly layout?: {
    readonly groups?: readonly {
      readonly id: string
      readonly title: string
      readonly surfaces: readonly string[]
    }[]
  }
}

export interface SurfaceLifecycleProjection {
  readonly phase: SurfaceDisplayPhase
  readonly latestEventId?: string
  readonly sessionId?: string
  readonly turn?: number
  readonly evidence: readonly { readonly name: string; readonly ref: EventRef }[]
  readonly verified: boolean
  readonly verificationEvidence: readonly { readonly name: string; readonly ref: EventRef }[]
}

/** Validate and detach one presentation-only View Definition. */
export function defineWorkSurfaceView(input: unknown): WorkSurfaceViewDefinition {
  assertJson(input, 'View Definition')
  if (!record(input)) throw invalid('View Definition must be an object')
  exactKeys(input, ['version', 'title', 'surfaces', 'orchestrations', 'interpretations', 'layout'], 'View Definition')
  if (input.version !== 1) throw invalid('View Definition version must be 1')
  optionalTitle(input.title, 'View Definition title')

  const surfaces = optionalRecord(input.surfaces, 'surfaces')
  for (const [surfaceId, raw] of Object.entries(surfaces)) {
    requireText(surfaceId, 'Surface id')
    if (!record(raw)) throw invalid(`Surface '${surfaceId}' view must be an object`)
    exactKeys(raw, ['title', 'titleLocked', 'group'], `Surface '${surfaceId}' view`)
    requireText(raw.title, `Surface '${surfaceId}' title`)
    if (raw.titleLocked !== undefined && typeof raw.titleLocked !== 'boolean') throw invalid(`Surface '${surfaceId}' titleLocked must be boolean`)
    if (raw.group !== undefined) requireText(raw.group, `Surface '${surfaceId}' group`)
  }

  const orchestrations = optionalRecord(input.orchestrations, 'orchestrations')
  for (const [orchestrationId, raw] of Object.entries(orchestrations)) {
    requireText(orchestrationId, 'Orchestration id')
    if (!record(raw)) throw invalid(`Orchestration '${orchestrationId}' view must be an object`)
    exactKeys(raw, ['title', 'subscriptions'], `Orchestration '${orchestrationId}' view`)
    requireText(raw.title, `Orchestration '${orchestrationId}' title`)
    const subscriptions = optionalRecord(raw.subscriptions, `Orchestration '${orchestrationId}' subscriptions`)
    for (const [subscriptionId, subscription] of Object.entries(subscriptions)) {
      requireText(subscriptionId, 'Subscription id')
      if (!record(subscription)) throw invalid(`Subscription '${subscriptionId}' view must be an object`)
      exactKeys(subscription, ['title'], `Subscription '${subscriptionId}' view`)
      requireText(subscription.title, `Subscription '${subscriptionId}' title`)
    }
  }

  const interpretations = input.interpretations ?? []
  if (!Array.isArray(interpretations)) throw invalid('interpretations must be an array')
  for (const [index, interpretation] of interpretations.entries()) {
    if (!record(interpretation)) throw invalid(`interpretations[${index}] must be an object`)
    exactKeys(interpretation, ['event', 'display', 'surface'], `interpretations[${index}]`)
    requireText(interpretation.event, `interpretations[${index}].event`)
    if (!['verified', 'completed', 'failed', 'waiting-user'].includes(String(interpretation.display))) {
      throw invalid(`interpretations[${index}].display is invalid`)
    }
    if (interpretation.surface !== undefined) requireText(interpretation.surface, `interpretations[${index}].surface`)
  }

  const groupIds = new Set<string>()
  if (input.layout !== undefined) {
    if (!record(input.layout)) throw invalid('layout must be an object')
    exactKeys(input.layout, ['groups'], 'layout')
    const groups = input.layout.groups ?? []
    if (!Array.isArray(groups)) throw invalid('layout.groups must be an array')
    for (const [index, group] of groups.entries()) {
      if (!record(group)) throw invalid(`layout.groups[${index}] must be an object`)
      exactKeys(group, ['id', 'title', 'surfaces'], `layout.groups[${index}]`)
      const id = requireText(group.id, `layout.groups[${index}].id`)
      if (groupIds.has(id)) throw invalid(`duplicate layout group '${id}'`)
      groupIds.add(id)
      requireText(group.title, `layout.groups[${index}].title`)
      if (!Array.isArray(group.surfaces) || group.surfaces.some(value => typeof value !== 'string' || value === '')) {
        throw invalid(`layout.groups[${index}].surfaces must be Surface ids`)
      }
      for (const surfaceId of group.surfaces) if (!Object.hasOwn(surfaces, surfaceId)) throw invalid(`layout group '${id}' references unknown Surface '${surfaceId}'`)
    }
  }
  for (const [surfaceId, raw] of Object.entries(surfaces)) {
    const group = (raw as Record<string, unknown>).group
    if (group !== undefined && !groupIds.has(String(group))) throw invalid(`Surface '${surfaceId}' references unknown group '${String(group)}'`)
  }

  return deepFreeze(structuredClone(input) as unknown as WorkSurfaceViewDefinition)
}

/** Fold current user-facing phase exclusively from durable WorkSurface events. */
export function projectSurfaceLifecycle(
  events: readonly { readonly ref: EventRef; readonly event: WorkSurfaceEvent }[],
  interpretations: readonly NonNullable<WorkSurfaceViewDefinition['interpretations']>[number][] = [],
  surfaceId?: string,
): SurfaceLifecycleProjection {
  let phase: SurfaceDisplayPhase = 'idle'
  let latestEventId: string | undefined
  let sessionId: string | undefined
  let turn: number | undefined
  let evidence: { name: string; ref: EventRef }[] = []
  let verified = false
  let verificationEvidence: { name: string; ref: EventRef }[] = []
  for (const candidate of events) {
    const { event, ref } = candidate
    if (event.name === 'surface.revision.published' || event.name === 'surface.publish.conflicted') {
      latestEventId = event.id
      sessionId = event.meta.sessionId
      turn = event.meta.turn
      phase = event.name === 'surface.revision.published' ? 'published' : 'conflicted'
      evidence = [{ name: event.name, ref }]
      verified = false
      verificationEvidence = []
    }
    for (const interpretation of interpretations) {
      if (interpretation.event !== event.name || (interpretation.surface !== undefined && interpretation.surface !== surfaceId)) continue
      if (interpretation.display === 'verified') {
        verified = true
        verificationEvidence.push({ name: event.name, ref })
      } else {
        phase = interpretation.display
        evidence.push({ name: event.name, ref })
      }
    }
  }
  return {
    phase,
    ...(latestEventId === undefined ? {} : { latestEventId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turn === undefined ? {} : { turn }),
    evidence: Object.freeze(evidence),
    verified,
    verificationEvidence: Object.freeze(verificationEvidence),
  }
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!record(value)) throw invalid(`${label} must be an object`)
  return value
}
function optionalTitle(value: unknown, label: string): void { if (value !== undefined) requireText(value, label) }
function requireText(value: unknown, label: string): string { if (typeof value !== 'string' || value.trim() === '') throw invalid(`${label} must be non-empty`); return value }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw invalid(`${label} contains unknown key '${key}'`) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
function invalid(message: string): WorkSurfaceError { return new WorkSurfaceError('invalid-definition', message) }
function assertJson(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(`${label} contains a non-finite number`); return }
  if (Array.isArray(value)) { for (const item of value) assertJson(item, label); return }
  if (!record(value)) throw invalid(`${label} must be lossless JSON`)
  for (const item of Object.values(value)) { if (item === undefined) throw invalid(`${label} contains undefined`); assertJson(item, label) }
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
