/**
 * Stable, platform-neutral instructions for deciding when and how to use
 * WorkSurface. Host adapters provide the concrete command/locator vocabulary.
 */

export interface WorkSurfaceGuidanceOptions {
  readonly hostSessionLabel?: string
  readonly authoringHelp?: string
  readonly coordinationHelp?: string
}

const DEFAULT_HOST_SESSION_LABEL = 'host session'
const DEFAULT_AUTHORING_HELP = 'the host WorkSurface authoring help entrypoint'
const DEFAULT_COORDINATION_HELP = 'the host WorkSurface coordination help entrypoint'

export function renderWorkSurfaceGuidance(options: WorkSurfaceGuidanceOptions = {}): string {
  const hostSessionLabel = options.hostSessionLabel ?? DEFAULT_HOST_SESSION_LABEL
  const authoringHelp = options.authoringHelp ?? DEFAULT_AUTHORING_HELP
  const coordinationHelp = options.coordinationHelp ?? DEFAULT_COORDINATION_HELP

  return [
    'WorkSurface is an available capability for durable, independently assessable work: multi-turn work, recovery or handoff, acceptance-checked artifacts, or independent workstreams that need coordination.',
    'A Surface is one objective\'s durable context—goal, acceptance criteria, files, decisions, deliverables, and evidence. Author it in ordinary files; coordinate independently assessable Surfaces, one objective per Surface.',
    `For a one-off edit, small answer, or short exploration: use an ordinary ${hostSessionLabel}. Orchestrate coordinates existing Surfaces only; it cannot create, delete, or rebind. The host owns session/turn/tools; WorkSurface records facts and progress, not arbitrary commands.`,
    `Answer what WorkSurface is and when to use it directly from this guidance, without tools or help. For how-to questions or actions, read the relevant help yourself: ${authoringHelp} for creation; ${coordinationHelp} for coordination. Do not invent commands.`,
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
}

/** Render the stable semantic part of a bound Surface-session instruction. */
export function renderSurfaceSessionGuidance(options: SurfaceSessionGuidanceOptions): string {
  return [
    `The current work is WorkSurface \`${options.surfaceId}\`. Its durable context belongs to this objective across execution sessions.`,
    `Read \`${options.turnBriefLocator}\` before acting: it is the current turn's bounded objective, acceptance criteria, file publication command, allowed outputs, and relevant context.`,
    `Use \`${options.surfaceLocator}\` as the durable working context and \`${options.authoringRootLocator}\` for ordinary files. Keep claims, decisions, deliverables, and evidence in the Surface when they matter for recovery or handoff.`,
    `Use ordinary file and script capabilities for authoring, ${options.authoringHelp} for authoring, ${options.coordinationHelp} only when coordinating existing Surfaces, and ${options.emitHelp} for the current turn's allowed outputs.`,
    'Before asking coordination to read changed files, use the Brief\'s `filePublication` command to publish them, then emit the authorized business output. Publishing files is available even when `outputs` is empty. Keep the same publication key for an uncertain retry and use a new key for a new publication.',
    'Emit only outputs allowed by the current turn brief. Follow help to resolve environment locators and replace parameter placeholders in `command.argv`, then execute the resolved argv directly. Treat recorded events and revisions as facts; do not invent completion or bypass the Surface contract.',
  ].join(' ')
}
