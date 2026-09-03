import { describe, expect, it } from 'vitest'
import {
  renderSurfaceSessionGuidance,
  renderWorkSurfaceGuidance,
  WORKSURFACE_GLOBAL_INSTRUCTIONS,
  WORKSURFACE_GUIDANCE_MAX_CHARS,
} from '../src/index.ts'

describe('platform-neutral WorkSurface design material', () => {
  it('keeps fixed discovery guidance small and host-independent', () => {
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS.length).toBeLessThanOrEqual(WORKSURFACE_GUIDANCE_MAX_CHARS)
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('WorkSurface is an available capability')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('independently assessable Surfaces')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).not.toMatch(/DSH|Cordis|DSH_/)
  })

  it('lets a host add locators without moving semantics into the adapter', () => {
    const guidance = renderWorkSurfaceGuidance({
      hostSessionLabel: 'pi session',
      authoringHelp: 'pi worksurface author command',
      coordinationHelp: 'pi worksurface coordinate command',
      shellFallback: 'If the host shell omits its locators, use the documented working directory fallback.',
    })
    const session = renderSurfaceSessionGuidance({
      surfaceId: 'surface-a',
      hostSessionLabel: 'pi session',
      surfaceLocator: '/work/surfaces/surface-a',
      turnBriefLocator: '/run/turn-brief.json',
      authoringRootLocator: '/work',
      authoringHelp: 'pi worksurface author command',
      coordinationHelp: 'pi worksurface coordinate command',
      emitHelp: 'pi worksurface emit command',
    })
    expect(guidance).toContain('pi session')
    expect(guidance).toContain('working directory fallback')
    expect(session).toContain('/run/turn-brief.json')
    expect(session).toContain('exact `command.argv` as argv')
    expect(session).not.toMatch(/DSH|Cordis|DSH_/)
  })
})
