import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashWorkspace } from '../src/workspace.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pf-workspace-hash-'))
  roots.push(root)
  return root
}

describe('public workspace hashing', () => {
  it('is deterministic across creation order and changes with public bytes', async () => {
    const left = await workspace()
    const right = await workspace()
    await mkdir(join(left, 'nested'), { recursive: true })
    await writeFile(join(left, 'z.txt'), 'z\n')
    await writeFile(join(left, 'nested', 'a.txt'), 'a\n')

    await writeFile(join(right, 'z.txt'), 'z\n')
    await mkdir(join(right, 'nested'), { recursive: true })
    await writeFile(join(right, 'nested', 'a.txt'), 'a\n')

    const first = await hashWorkspace(left)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await hashWorkspace(right)).toBe(first)
    await writeFile(join(right, 'nested', 'a.txt'), 'changed\n')
    expect(await hashWorkspace(right)).not.toBe(first)
  })

  it('rejects symlinks from attempt identity input', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'value.txt'), 'outside\n')
    await symlink(outside, join(root, 'linked'))
    await expect(hashWorkspace(root)).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
