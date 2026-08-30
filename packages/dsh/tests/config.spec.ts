import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('WorkSurface configuration', () => {
  it('anchors the default authoring root to the configured plugin root', () => {
    const config = resolveConfig({ root: './state' })
    expect(config.workRoot).toBe(join(resolve('./state'), 'work'))
  })

  it('honors an explicit authoring root without consulting daemon cwd', () => {
    expect(resolveConfig({ root: './state', workRoot: './authoring' }).workRoot).toBe(resolve('./authoring'))
  })
})
