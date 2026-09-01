import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/bin.ts'
import { WorkSurfaceHostClient } from '../src/client.ts'

afterEach(() => vi.restoreAllMocks())

describe('ws emit', () => {
  it('prints scenario help and rejects unknown topics', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await main(['help', 'author'])).toBe(0)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('WORKSURFACE AUTHORING'))
    expect(await main(['help', 'invented'])).toBe(15)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Unknown WorkSurface help topic 'invented'"))
  })

  it('uses the current DSH Turn capability for publication', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ subject: 'surface:a', seq: 2, id: 'terminal' })
    const code = await main(['emit', 'surface.revision.published', '--payload', '{"summary":"ok"}'], {
      DSH_SURFACE_ID: 'surface-a', DSH_CONTEXT_FILE: '/context', DSH_SURFACE_DIR: '/work/surfaces/surface-a',
      DSH_WORKSURFACE_ROOT: '/work', DSH_WORKSURFACE_SOCKET: '/host.sock', DSH_WORKSURFACE_CAPABILITY: 'cap-a',
    })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('event.emit-turn', { capability: 'cap-a', name: 'surface.revision.published', payload: { summary: 'ok' } })
  })

  it.each([
    [['surface', 'create', 'child-a', '--contract-file', 'surface.md']],
    [['orchestrate', 'register', 'plan', '--definition-file', 'definition.json']],
    [['open', 'review-a']],
  ])('rejects removed model command %s before transport', async (argv: string[]) => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call')
    expect(await main(argv)).toBe(15)
    expect(call).not.toHaveBeenCalled()
  })
})
