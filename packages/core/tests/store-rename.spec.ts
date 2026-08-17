import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    rename: vi.fn(async (
      source: Parameters<typeof original.rename>[0],
      destination: Parameters<typeof original.rename>[1],
    ) => {
      if (String(destination).includes('/revisions/')) {
        throw Object.assign(new Error('rename denied'), { code: 'EACCES' })
      }
      await original.rename(source, destination)
    }),
  }
})

import { WorkSurfaceStore } from '../src/store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('immutable revision publication', () => {
  it('propagates an unexpected atomic rename failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worksurface-rename-'))
    roots.push(root)
    const template = join(root, 'template')
    await mkdir(join(template, 'blocks'), { recursive: true })
    await writeFile(join(template, 'surface.md'), '# Goal\n')
    const store = new WorkSurfaceStore({ root: join(root, 'store') })
    await expect(store.newSurface({ attemptId: 'attempt', key: 'root', templatePath: template, surface: 'ws-root' }))
      .rejects.toMatchObject({ code: 'effect-failed', message: 'rename denied' })
  })
})
