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
      text: renderSurfaceSessionGuidance({
        surfaceId,
        hostSessionLabel: 'DSH Session',
        surfaceLocator: '$DSH_SURFACE_DIR',
        turnBriefLocator: '$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json',
        authoringRootLocator: '$DSH_WORKSURFACE_ROOT',
        authoringHelp: '`"$DSH_WORKSURFACE_CLI" help author`',
        coordinationHelp: '`"$DSH_WORKSURFACE_CLI" help coordinate`',
        emitHelp: '`"$DSH_WORKSURFACE_CLI" help emit` or `help recover`',
        shellFallback: 'If a persistent DSH shell omits DSH_* variables, use `ws` from PATH, the session cwd as root, and `surfaces/<surface-id>` for this Surface; if the Turn Brief variable is missing, report the host injection failure instead of guessing a view path.',
      }),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}

/**
 * Concrete per-Turn locator fallback for hosts whose persistent PTY does not
 * consume the shell-env overlay. This is intentionally separate from the
 * stable session guidance so recurring Turns do not duplicate the concept
 * and boundary text.
 */
export function workSurfaceTurnInstructions(surfaceId: string, locators: WorkSurfaceTurnLocators) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `Current WorkSurface adapter locators for DSH Turn (valid only for this Turn): Surface ${JSON.stringify(surfaceId)} directory is ${JSON.stringify(locators.surfaceDir)}; Turn Brief is ${JSON.stringify(locators.turnBriefPath)}; authoring root is ${JSON.stringify(locators.authoringRoot)}; CLI is ${JSON.stringify(locators.cliPath)}.`,
        'If the persistent bash shell omits DSH_* variables, use these exact paths instead of guessing or searching hidden runtime directories. Read this Turn Brief before acting; do not reuse these Turn paths after the Turn ends.',
      ].join(' '),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
