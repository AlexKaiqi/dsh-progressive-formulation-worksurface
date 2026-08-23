import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkSurfaceStore } from '@pf-worksurface/core'
import { executeDirect } from '../src/direct.ts'
import * as invariant from '../src/invariant.ts'
import type { WorkSurfaceRpcMethod } from '../src/protocol.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; template: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'worksurface-direct-'))
  roots.push(directory)
  const template = join(directory, 'template')
  await mkdir(join(template, 'blocks'), { recursive: true })
  await writeFile(join(template, 'surface.md'), '# Goal\n')
  await writeFile(join(template, 'blocks', 'result.md'), '---\nblock_id: result\nsurface_id: template\nkind: result\nstatus: active\nderived_from: []\n---\nResult\n')
  return { root: join(directory, 'store'), template }
}

describe('executeDirect', () => {
  it('runs every file operation with optional revisions, parents, and retries', async () => {
    const { root, template } = await fixture()
    // Direct mode operates on existing canonical state; surfaces are seeded
    // through the store because creation is bound to Host delegation.
    const store = new WorkSurfaceStore({ root })
    const parent = await store.newSurface({ attemptId: 'attempt', key: 'parent', templatePath: template, surface: 'ws-parent' })
    const child = await store.newSurface({
      attemptId: 'attempt', key: 'child', templatePath: template, parent: parent.surface, surface: 'ws-child',
    })

    const directory = join(root, '..', 'checkout')
    await executeDirect(root, 'checkout', 'attempt', { surface: child.surface, targetPath: directory, revision: child.revision })
    await writeFile(join(directory, 'surface.md'), `${await readFile(join(directory, 'surface.md'), 'utf8')}\nChanged\n`)
    const committed = await executeDirect(root, 'commit', 'attempt', {
      key: 'commit', workingPath: directory, baseRevision: child.revision, retry: true,
    }) as { revision: string }
    const shown = await executeDirect(root, 'show', 'attempt', { surface: child.surface }) as {
      revision: string
      blocks: Record<string, string>
    }
    expect(shown.revision).toBe(committed.revision)
    expect(shown.blocks.result).toContain('Result')
    await expect(executeDirect(root, 'show', 'attempt', { surface: child.surface, revision: child.revision }))
      .resolves.toMatchObject({ revision: child.revision })
    await expect(executeDirect(root, 'projection', 'attempt', {
      surface: child.surface, profile: 'test', tokenBudget: 1000,
    })).resolves.toMatchObject({ surfaceId: child.surface })
    await expect(executeDirect(root, 'projection', 'attempt', {
      surface: child.surface, profile: 'test', tokenBudget: 1000, revision: child.revision,
    })).resolves.toMatchObject({ surfaceRevision: child.revision })

    const secondCheckout = join(root, '..', 'checkout-current')
    await expect(executeDirect(root, 'checkout', 'attempt', { surface: child.surface, targetPath: secondCheckout }))
      .resolves.toMatchObject({ revision: committed.revision })
    await expect(executeDirect(root, 'commit', 'attempt', {
      key: 'commit-current', workingPath: secondCheckout, baseRevision: committed.revision,
    })).resolves.toMatchObject({ noOp: true })
  })

  it('rejects Host-only, invalid typed parameters, and an unreachable method', async () => {
    const { root } = await fixture()
    await expect(executeDirect(root, 'agent.run', 'attempt', {})).rejects.toMatchObject({ code: 'unauthorized' })
    for (const params of [
      { surface: 1, targetPath: 'x' },
      { surface: '', targetPath: 'x' },
      { surface: 'ws-root', targetPath: 1 },
      { surface: 'ws-root', targetPath: '' },
    ]) {
      await expect(executeDirect(root, 'checkout', 'attempt', params)).rejects.toMatchObject({ code: 'invalid-working-copy' })
    }
    for (const tokenBudget of ['1', 1.5]) {
      await expect(executeDirect(root, 'projection', 'attempt', {
        surface: 'ws-root', profile: 'test', tokenBudget,
      })).rejects.toMatchObject({ code: 'invalid-working-copy' })
    }
    await expect(executeDirect(root, 'unknown' as WorkSurfaceRpcMethod, 'attempt', {})).rejects.toThrow('unknown direct WorkSurface method')
  })
})

describe('CLI invariant companion', () => {
  it('reserves package ownership', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _installer: (ctx: never) => void) => dispose)
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(invariant.name).toBe('worksurface-cli-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@pf-worksurface/cli', expect.any(Function))
    expect(register.mock.calls[0]?.[1]?.({} as never)).toBeUndefined()
  })
})
