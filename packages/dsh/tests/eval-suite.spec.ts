import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
// @ts-expect-error executable evaluator has no declarations
import { validateModelSuite } from '../evals/validate-suite.mjs'

describe('WorkSurface event acceptance suite', () => {
  it('covers replay, recovery, handler boundaries, CAS, and client equivalence', async () => {
    const suite = JSON.parse(await readFile(new URL('../evals/suite.json', import.meta.url), 'utf8'))
    expect(validateModelSuite(suite)).toEqual([])
    expect(suite.cases).toHaveLength(6)
    expect(new Set(suite.cases.map((item: { testFile: string }) => item.testFile)).size).toBeGreaterThanOrEqual(4)
  })
})
