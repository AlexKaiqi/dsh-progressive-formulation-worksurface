import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkSurfaceHostClient, type WorkSurfaceRpcMethod } from '@pf-worksurface/cli'
import { WorkSurfaceHost } from '../src/host.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('WorkSurface Host protocol', () => {
  it('dispatches the read-only legacy report method', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worksurface-host-')); roots.push(root)
    const socket = join(root, 'host.sock')
    const host = new WorkSurfaceHost(socket, { dispatch: request => Promise.resolve({ method: request.method }) })
    await host.start()
    try {
      await expect(new WorkSurfaceHostClient(socket).call('legacy.report', {})).resolves.toEqual({ method: 'legacy.report' })
    } finally {
      await host.close()
    }
  })

  it('admits the Service-owned event watch method', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worksurface-host-')); roots.push(root)
    const socket = join(root, 'host.sock')
    const host = new WorkSurfaceHost(socket, { dispatch: request => Promise.resolve({ method: request.method }) })
    await host.start()
    try {
      await expect(new WorkSurfaceHostClient(socket).call('event.watch', { surfaceId: 'surface' }))
        .resolves.toEqual({ method: 'event.watch' })
    } finally {
      await host.close()
    }
  })

  it('preserves request correlation when rejecting an unknown method', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worksurface-host-')); roots.push(root)
    const socket = join(root, 'host.sock')
    const host = new WorkSurfaceHost(socket, { dispatch: () => Promise.reject(new Error('must not dispatch')) })
    await host.start()
    try {
      await expect(new WorkSurfaceHostClient(socket).call('future.method' as WorkSurfaceRpcMethod, {}))
        .rejects.toMatchObject({ code: 'invalid-working-copy', message: "Unknown Host method 'future.method'" })
    } finally {
      await host.close()
    }
  })

  it('gives the CLI transport and direct Service call the same mutation semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worksurface-host-')); roots.push(root)
    const socket = join(root, 'host.sock')
    const accepted: unknown[] = []
    const service = {
      dispatch: (request: { method: string; params: Record<string, unknown> }) => {
        accepted.push(structuredClone(request))
        return Promise.resolve({ subject: `surface:${request.params.surfaceId}`, seq: accepted.length - 1 })
      },
    }
    const host = new WorkSurfaceHost(socket, service)
    await host.start()
    try {
      const direct = await service.dispatch({ method: 'event.emit', params: { surfaceId: 'surface', name: 'ready', payload: null, eventId: 'direct' } })
      const transported = await new WorkSurfaceHostClient(socket).call('event.emit', {
        surfaceId: 'surface', name: 'ready', payload: null, eventId: 'transported',
      })
      expect(direct).toEqual({ subject: 'surface:surface', seq: 0 })
      expect(transported).toEqual({ subject: 'surface:surface', seq: 1 })
      expect(accepted.map(item => (item as { method: string }).method)).toEqual(['event.emit', 'event.emit'])
    } finally {
      await host.close()
    }
  })
})
