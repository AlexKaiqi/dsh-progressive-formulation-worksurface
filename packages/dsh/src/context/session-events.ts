import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { Revision } from '@pf-worksurface/core'
import type { ContextLifetime, InjectionSection, RenderManifest, WorkSurfaceContextManifest } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'worksurface/context-revision': { surfaceId: string; revision: Revision; previousRevision: Revision | null; manifest: WorkSurfaceContextManifest }
    'context/occurrence-created': { occurrenceId: string; kind: 'analysis' | 'acceptance' | 'recovery' | 'maintenance'; target: { sessionId: string; surfaceId?: string; revision?: Revision; requestOccurrenceId?: string; phaseOccurrenceId?: string }; lifetime: ContextLifetime }
    'context/provider-settled': { occurrenceId: string; providerId: string; result: { kind: 'no-contribution' } | { kind: 'contribution'; sections: readonly InjectionSection[] } | { kind: 'failed'; errorCode: string; retryable: boolean }; ready: boolean }
    'context/occurrence-consumed': { occurrenceId: string; planId: Revision }
    'context/occurrence-ended': { occurrenceId: string; reason: string }
    'context/rendered': { manifest: RenderManifest }
    'context/maintenance-completed': { key: string; operation: 'compact' | 'prune'; requestHash: Revision; result: unknown }
    'compaction/prune': { shadowedRange: { start: number; end: number }; shadowedSeqs: number[]; shadowedTokenCount: number }
  }
}

// Persistence must know every extension event before it restores a Session.
for (const type of [
  'worksurface/context-revision',
  'context/occurrence-created',
  'context/provider-settled',
  'context/occurrence-consumed',
  'context/occurrence-ended',
  'context/rendered',
  'context/maintenance-completed',
  'compaction/prune',
] as const) {
  ;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add(type)
}

export {}
