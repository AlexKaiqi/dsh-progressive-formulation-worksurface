/**
 * Stable, platform-neutral instructions for deciding when and how to use
 * WorkSurface. Host adapters provide the concrete command/locator vocabulary.
 */

export interface WorkSurfaceGuidanceOptions {
  readonly hostSessionLabel?: string
  readonly authoringHelp?: string
  readonly coordinationHelp?: string
  /** Optional host-specific fallback for shells that do not retain env overlays. */
  readonly shellFallback?: string
}

const DEFAULT_HOST_SESSION_LABEL = 'host session'
const DEFAULT_AUTHORING_HELP = 'the host WorkSurface authoring help entrypoint'
const DEFAULT_COORDINATION_HELP = 'the host WorkSurface coordination help entrypoint'

export function renderWorkSurfaceGuidance(options: WorkSurfaceGuidanceOptions = {}): string {
  const hostSessionLabel = options.hostSessionLabel ?? DEFAULT_HOST_SESSION_LABEL
  const authoringHelp = options.authoringHelp ?? DEFAULT_AUTHORING_HELP
  const coordinationHelp = options.coordinationHelp ?? DEFAULT_COORDINATION_HELP
  const shellFallback = options.shellFallback === undefined ? '' : ` ${options.shellFallback}`

  return [
    'WorkSurface is an available capability for durable, independently assessable work: multi-turn work, recovery or handoff, acceptance-checked artifacts, or independent workstreams that need coordination.',
    'A Surface is one objective\'s durable context—goal, acceptance criteria, files, decisions, deliverables, and evidence. Author it in ordinary files; coordinate independently assessable Surfaces, one objective per Surface.',
    `For a one-off edit, small answer, or short exploration: use an ordinary ${hostSessionLabel}. Orchestrate coordinates existing Surfaces only; it cannot create, delete, or rebind. The host owns session/turn/tools; WorkSurface records facts and progress, not arbitrary commands.`,
    `When it fits, start with ${authoringHelp}; for an existing multi-Surface objective use ${coordinationHelp}.${shellFallback}`,
  ].join(' ')
}

export const WORKSURFACE_GLOBAL_INSTRUCTIONS = renderWorkSurfaceGuidance()
export const WORKSURFACE_GUIDANCE_MAX_CHARS = 1200

export interface SurfaceSessionGuidanceOptions {
  readonly surfaceId: string
  readonly hostSessionLabel?: string
  readonly surfaceLocator: string
  readonly turnBriefLocator: string
  readonly authoringRootLocator: string
  readonly authoringHelp: string
  readonly coordinationHelp: string
  readonly emitHelp: string
  /** Optional host-specific fallback when a persistent shell omits env overlays. */
  readonly shellFallback?: string
}

/** Render the stable semantic part of a bound Surface-session instruction. */
export function renderSurfaceSessionGuidance(options: SurfaceSessionGuidanceOptions): string {
  const hostSessionLabel = options.hostSessionLabel ?? 'host session'
  const shellFallback = options.shellFallback === undefined ? '' : ` ${options.shellFallback}`

  return [
    `This ${hostSessionLabel} represents the complete progress history of WorkSurface \`${options.surfaceId}\` and is bound to that Surface.`,
    'The binding was established before the session started; you cannot open, select, or switch to another Surface from this session; do not rebind it.',
    `Read \`${options.turnBriefLocator}\` before acting: it is the current turn's bounded objective, acceptance criteria, allowed outputs, and relevant context.`,
    `Use \`${options.surfaceLocator}\` as the durable working context and \`${options.authoringRootLocator}\` for ordinary files. Keep claims, decisions, deliverables, and evidence in the Surface when they matter for recovery or handoff.`,
    `Use ordinary file and script capabilities for authoring, ${options.authoringHelp} for authoring, ${options.coordinationHelp} only when coordinating existing Surfaces, and ${options.emitHelp} for the current turn's allowed outputs.${shellFallback}`,
    'Emit only outputs allowed by the current turn brief, and run its exact `command.argv` as argv. Treat recorded events and revisions as facts; do not invent completion or bypass the Surface contract.',
  ].join(' ')
}
