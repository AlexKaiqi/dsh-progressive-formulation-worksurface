import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/bin.ts'
import { WorkSurfaceHostClient } from '../src/client.ts'

afterEach(() => vi.restoreAllMocks())

describe('ws emit', () => {
  it('publishes only the active Turn using a required stable key and no caller-selected Surface', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ published: true })
    const env = { WORKSURFACE_SOCKET: '/host.sock', WORKSURFACE_CAPABILITY: 'current-turn' }
    expect(await main(['publish', '--key', 'findings-v1', '--summary', 'Reviewed findings'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('surface.publish', { capability: 'current-turn', operationKey: 'findings-v1', summary: 'Reviewed findings' })
    expect(await main(['publish', '--key', 'findings-v1'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('surface.publish', { capability: 'current-turn', operationKey: 'findings-v1' })
    call.mockClear()
    for (const args of [['publish'], ['publish', '--key', 'x', '--surface', 'other'], ['publish', '--key', 'x', '--capability', 'other']]) {
      expect(await main(args, env)).toBe(15)
    }
    expect(await main(['publish', '--key', 'x'], { WORKSURFACE_SOCKET: '/host.sock' })).toBe(14)
    expect(call).not.toHaveBeenCalled()
  })
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

  it('accepts portable locators without requiring a DSH host', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ accepted: true })
    expect(await main(['emit', 'review.completed', '--payload', '{}'], {
      WORKSURFACE_SOCKET: '/portable.sock', WORKSURFACE_SURFACE_ID: 'review', WORKSURFACE_CAPABILITY: 'portable-turn',
    })).toBe(0)
    expect(call).toHaveBeenCalledWith('event.emit-turn', { capability: 'portable-turn', name: 'review.completed', payload: {} })
  })

  it('admits authoring and explicitly requests host execution using stable request keys', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ accepted: true })
    const env = { WORKSURFACE_SOCKET: '/portable.sock' }
    expect(await main(['sync'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('authoring.sync', {})
    expect(await main(['list'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('surface.list', {})
    expect(await main(['run', 'report', '--instruction', 'Finish the evidence-backed report.', '--key', 'report-first'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('surface.run', {
      surfaceId: 'report', instruction: 'Finish the evidence-backed report.', operationKey: 'report-first',
    })
    expect(await main(['recover'], env)).toBe(0)
    expect(call).toHaveBeenLastCalledWith('runtime.recover', {})
    call.mockClear()
    expect(await main(['run', 'report', '--instruction', 'Task without retry identity'], env)).toBe(15)
    expect(call).not.toHaveBeenCalled()
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
