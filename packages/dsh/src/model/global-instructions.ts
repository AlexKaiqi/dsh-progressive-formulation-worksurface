import { renderWorkSurfaceGuidance } from '@pf-worksurface/design'

/** DSH supplies concrete entrypoints; the semantic guidance lives in design. */
export const WORKSURFACE_GLOBAL_INSTRUCTIONS = renderWorkSurfaceGuidance({
  hostSessionLabel: 'DSH Session',
  authoringHelp: '`"$DSH_WORKSURFACE_CLI" help` or `"$DSH_WORKSURFACE_CLI" help author`',
  coordinationHelp: '`"$DSH_WORKSURFACE_CLI" help` or `"$DSH_WORKSURFACE_CLI" help coordinate`',
})

export const WORKSURFACE_PROMPT_SECTION = 'worksurface:guidance'
export const WORKSURFACE_PROMPT_ORDER = 185
