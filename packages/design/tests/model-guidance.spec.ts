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
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).toContain('directly from this guidance, without tools or help')
    expect(WORKSURFACE_GLOBAL_INSTRUCTIONS).not.toMatch(/DSH|Cordis|DSH_/)
  })

  it('lets a host add locators without moving semantics into the adapter', () => {
    const guidance = renderWorkSurfaceGuidance({
      hostSessionLabel: 'pi session',
      authoringHelp: 'pi worksurface author command',
      coordinationHelp: 'pi worksurface coordinate command',
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
    expect(guidance).toContain('For how-to questions or actions, read the relevant help yourself')
    expect(session).toContain('/run/turn-brief.json')
    expect(session).toContain('resolve environment locators and replace parameter placeholders in `command.argv`')
    expect(session).toContain('execute the resolved argv directly')
    expect(session).toContain('`filePublication` command')
    expect(session).toContain('even when `outputs` is empty')
    expect(session).not.toMatch(/DSH|Cordis|DSH_/)
    expect(session).not.toContain('cannot open, select, or switch')
    expect(session).toContain('across execution sessions')
  })
})
