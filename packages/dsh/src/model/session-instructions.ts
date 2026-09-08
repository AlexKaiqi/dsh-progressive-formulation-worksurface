import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSurfaceSessionGuidance } from '@pf-worksurface/design'

export interface WorkSurfaceTurnLocators {
  readonly surfaceDir: string
  readonly turnBriefPath: string
  readonly authoringRoot: string
  readonly cliPath: string
}

/** Stable guidance; task-specific data and output capability live in the Turn Brief. */
export function workSurfaceInstructions(surfaceId: string) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `This DSH Session represents the complete progress history of WorkSurface ${JSON.stringify(surfaceId)}. Its binding was established before startup; you cannot open, select, or switch this Session to another Surface.`,
        renderSurfaceSessionGuidance({
        surfaceId,
        hostSessionLabel: 'DSH Session',
        surfaceLocator: '$DSH_SURFACE_DIR',
        turnBriefLocator: '$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json',
        authoringRootLocator: '$DSH_WORKSURFACE_ROOT',
        authoringHelp: '`"$DSH_WORKSURFACE_CLI" help author`',
        coordinationHelp: '`"$DSH_WORKSURFACE_CLI" help coordinate`',
        emitHelp: '`"$DSH_WORKSURFACE_CLI" help publish`, `help emit`, or `help recover`',
        }),
        'The host refreshes WorkSurface variables in each Bash call; if the Turn Brief variable is missing, report the host injection failure. Do not guess a hidden path or assume cwd is the authoring root.',
      ].join(' '),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}

/**
 * Concrete per-Turn context for inspection. Shell variables must still be
 * supplied by the host consumer; these paths do not replace environment injection.
 */
export function workSurfaceTurnInstructions(surfaceId: string, locators: WorkSurfaceTurnLocators) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `Current WorkSurface adapter locators for DSH Turn (valid only for this Turn): Surface ${JSON.stringify(surfaceId)} directory is ${JSON.stringify(locators.surfaceDir)}; Turn Brief is ${JSON.stringify(locators.turnBriefPath)}; authoring root is ${JSON.stringify(locators.authoringRoot)}; CLI is ${JSON.stringify(locators.cliPath)}.`,
        'Read this Turn Brief before acting; do not reuse these Turn paths after the Turn ends. Missing Bash environment variables are a host injection failure, even when these inspection paths remain readable.',
      ].join(' '),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
