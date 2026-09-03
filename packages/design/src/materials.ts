import { SURFACE_SECTION_TITLES, SURFACE_TEMPLATE } from '@pf-worksurface/core'

/**
 * The small set of authoring standards that must stay aligned with the core
 * validator. Detailed procedural help remains a host/CLI concern.
 */
export const WORKSURFACE_MAINTENANCE_STANDARD = Object.freeze({
  surfaceSections: SURFACE_SECTION_TITLES,
  surfaceTemplate: SURFACE_TEMPLATE,
  oneSurfacePerObjective: true,
  ordinaryFilesAreDurableContext: true,
  acceptanceMustBeIndependentlyCheckable: true,
})
