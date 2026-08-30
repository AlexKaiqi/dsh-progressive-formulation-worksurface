import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/bin.ts'
import { WorkSurfaceHostClient } from '../src/client.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ws emit', () => {
  it('uses the current DSH Turn capability for publication', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ subject: 'surface:a', seq: 2, id: 'terminal' })
    const code = await main(['emit', 'surface.revision.published', '--payload', '{"summary":"ok"}'], {
      DSH_SURFACE_ID: 'surface-a', DSH_CONTEXT_FILE: '/context', DSH_SURFACE_DIR: '/work',
      DSH_WORKSURFACE_SOCKET: '/host.sock', DSH_WORKSURFACE_CAPABILITY: 'cap-a',
    })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('event.emit-turn', { capability: 'cap-a', name: 'surface.revision.published', payload: { summary: 'ok' } })
  })

  it('creates a Surface contract through the current planning capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-cli-create-')); roots.push(root)
    const contract = join(root, 'surface.md')
    await writeFile(contract, '# Goal\n\n# Acceptance Criteria\n\n# Known Facts and Constraints\n\n# Assumptions\n\n# Open Questions\n\n# Current Decisions\n\n# Deliverables and Evidence\n')
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ surfaceId: 'child-a', created: true })
    expect(await main(['surface', 'create', 'child-a', '--contract-file', contract], {
      DSH_WORKSURFACE_SOCKET: '/host.sock', DSH_WORKSURFACE_CAPABILITY: 'cap-a',
    })).toBe(0)
    expect(call).toHaveBeenCalledWith('surface.create', {
      capability: 'cap-a', surfaceId: 'child-a', markdown: expect.stringContaining('# Acceptance Criteria'),
    })
  })

  it('registers an exact orchestration before root events are emitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-cli-orchestrate-')); roots.push(root)
    const definitionPath = join(root, 'definition.json')
    const definition = {
      version: 1, roles: ['planner', 'child'], subscriptions: [{
        id: 'start-child', history: 'all',
        when: { role: 'planner', event: 'plan.started' },
        reaction: { followup: [{ role: 'child', message: 'Execute the child contract.', operationKey: 'start-child' }] },
      }],
    }
    await writeFile(definitionPath, JSON.stringify(definition))
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call').mockResolvedValue({ registrationId: 'reg-plan' })
    expect(await main([
      'orchestrate', 'register', 'plan', '--definition-file', definitionPath,
      '--bindings', '{"planner":"root","child":"child-a"}', '--registration', 'reg-plan',
    ], { DSH_WORKSURFACE_SOCKET: '/host.sock', DSH_WORKSURFACE_CAPABILITY: 'cap-a' })).toBe(0)
    expect(call).toHaveBeenCalledWith('orchestrate.register', {
      capability: 'cap-a', orchestrationId: 'plan', registrationId: 'reg-plan', definition,
      bindings: { planner: 'root', child: 'child-a' },
    })
  })

  it('rejects the removed open command before transport', async () => {
    const call = vi.spyOn(WorkSurfaceHostClient.prototype, 'call')
    expect(await main(['open', 'review-a', '--socket', '/host.sock', '--capability', 'cap-a'])).toBe(15)
    expect(call).not.toHaveBeenCalled()
  })
})
