import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('WorkSurface bundle composition', () => {
  it('loads block-to-file before the WorkSurface service', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { inventory: { dependencies: string[] } }
      peerDependencies: Record<string, string>
    }
    expect(pkg.dsh.inventory.dependencies).toContain('dsh-block-to-file')
    expect(pkg.peerDependencies['dsh-block-to-file']).toBeDefined()

    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch.indexOf('id: block-to-file')).toBeGreaterThanOrEqual(0)
    expect(patch.indexOf('id: block-to-file')).toBeLessThan(patch.indexOf('id: pf-worksurface'))
  })
})
