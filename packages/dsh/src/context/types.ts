import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Revision } from '@pf-worksurface/core'

export type ContextPriority = 'required' | 'high' | 'normal' | 'low'
export type ContextOmissionPolicy = 'never' | 'whole-item'
export type ContextOccurrenceKind = 'analysis' | 'acceptance' | 'recovery' | 'maintenance'

export type ContextLifetime =
  | { readonly kind: 'request' }
  | { readonly kind: 'phase' }
  | { readonly kind: 'until-revision-change'; readonly revision: Revision }
  | { readonly kind: 'until-event'; readonly eventType: string }
  | { readonly kind: 'session' }

export type ContextContentRef =
  | { readonly kind: 'worksurface-file'; readonly surfaceId: string; readonly revision: Revision; readonly path: string; readonly contentHash: Revision; readonly size: number }
  | { readonly kind: 'session-event'; readonly sessionId: string; readonly seq: number; readonly contentHash: Revision }
  | { readonly kind: 'blob'; readonly id: string; readonly contentHash: Revision }

export interface WorkSurfaceContextManifest {
  readonly surfaceId: string
  readonly revision: Revision
  readonly files: readonly Extract<ContextContentRef, { kind: 'worksurface-file' }>[]
  readonly manifestHash: Revision
}

export interface WorkSurfaceContextState {
  readonly surfaceId: string | null
  readonly revision: Revision | null
  readonly manifestHash: Revision | null
  readonly files: readonly Extract<ContextContentRef, { kind: 'worksurface-file' }>[]
}

export interface InjectionSection {
  readonly sectionId: string
  readonly providerId: string
  readonly contentRef: ContextContentRef
  readonly contentHash: Revision
  readonly sourceVersion: string
  readonly priority: ContextPriority
}

export interface ProviderFailure { readonly providerId: string; readonly errorCode: string; readonly retryable: boolean }

export interface InjectionOccurrence {
  readonly occurrenceId: string
  readonly kind: ContextOccurrenceKind
  readonly status: 'collecting' | 'ready' | 'consumed' | 'ended'
  readonly target: { readonly sessionId: string; readonly surfaceId?: string; readonly revision?: Revision; readonly requestOccurrenceId?: string; readonly phaseOccurrenceId?: string }
  readonly lifetime: ContextLifetime
  readonly sections: readonly InjectionSection[]
  readonly failures: readonly ProviderFailure[]
}

export interface InjectionState { readonly occurrences: readonly InjectionOccurrence[] }

export interface ContextItem {
  readonly itemId: string
  readonly kind: 'conversation-message' | 'compaction-checkpoint' | 'surface-file' | 'runtime-injection' | 'recovery-state'
  readonly contentRef: ContextContentRef
  readonly sourceFactSeqs: readonly number[]
  readonly priority: ContextPriority
  readonly omissionPolicy: ContextOmissionPolicy
  readonly lifetime: ContextLifetime
  readonly estimatedTokens?: number
}

export interface ContextPlan {
  readonly version: 1
  readonly planId: Revision
  readonly sessionId: string
  readonly asOfSeq: number
  readonly sources: { readonly conversationGeneration: number; readonly workSurfaceRevision: Revision | null; readonly workSurfaceManifestHash: Revision | null; readonly injectionOccurrenceIds: readonly string[] }
  readonly items: readonly ContextItem[]
}

export interface ModelTarget { readonly provider?: string; readonly model?: string; readonly contextWindow?: number }
export interface RenderBudget { readonly maxInputTokens: number }

export interface RenderManifest {
  readonly adapterId: string
  readonly adapterVersion: number
  readonly planId: Revision
  readonly asOfSeq: number
  readonly includedItems: readonly string[]
  readonly omittedItems: readonly { readonly itemId: string; readonly reason: 'token-budget' | 'unsupported-modality' }[]
  readonly estimatedTokens: number
  readonly target: ModelTarget
  readonly contentHash: Revision
}

export interface RenderedContext { readonly contexts: readonly { readonly name: string; readonly text: string }[]; readonly messages: readonly unknown[]; readonly manifest: RenderManifest }

export interface ContextProviderOccurrence { readonly occurrenceId: string; readonly kind: ContextOccurrenceKind; readonly target: InjectionOccurrence['target']; readonly lifetime: ContextLifetime }

export type ContextProviderResult =
  | { readonly kind: 'no-contribution' }
  | { readonly kind: 'contribution'; readonly sections: readonly { readonly sectionId: string; readonly content?: string; readonly contentRef?: ContextContentRef; readonly contentHash?: Revision; readonly sourceVersion: string; readonly priority: ContextPriority }[] }
  | { readonly kind: 'failed'; readonly errorCode: string; readonly retryable: boolean }

export interface ContextProviderRegistration {
  readonly providerId: string
  readonly phases: readonly ContextOccurrenceKind[]
  readonly order: number
  readonly required: boolean
  readonly timeoutMs: number
  readonly provide: (occurrence: ContextProviderOccurrence, signal: AbortSignal) => Promise<ContextProviderResult>
}

export interface ModelContextAdapter {
  readonly id: string
  readonly version: number
  supports(target: ModelTarget): boolean
  render(agent: Agent, plan: ContextPlan, target: ModelTarget, budget: RenderBudget): Promise<RenderedContext>
}

export interface ContextInspection {
  readonly sessionId: string
  readonly asOfSeq: number
  readonly surfaceGeneration: number
  readonly surfaceNodes: readonly { readonly position: number; readonly seq: number; readonly type: string; readonly estimatedTokens: number }[]
  readonly workSurface: WorkSurfaceContextState
  readonly activeInjections: readonly InjectionOccurrence[]
  readonly plan: ContextPlan
  readonly lastRender: RenderManifest | null
}
