import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
// @ts-expect-error executable internal evaluator does not ship declarations
import { validateModelSuite } from '../evals/validate-suite.mjs'

describe('real-model WorkSurface evaluation contract', () => {
  test('covers decision, operation, delegation, recovery, traceability, and stability', async () => {
    const suite = JSON.parse(await readFile(new URL('../evals/suite.json', import.meta.url), 'utf8'))
    expect(validateModelSuite(suite)).toEqual([])
    expect(suite.cases).toHaveLength(8)
    expect(suite.cases.filter((testCase: { tier: string }) => testCase.tier === 'release')).toHaveLength(7)
    expect(new Set(suite.cases.flatMap((testCase: { validates: string[] }) => testCase.validates))).toEqual(new Set(suite.dimensions.map((dimension: { id: string }) => dimension.id)))
  })

  test('does not leak the WorkSurface answer into adoption prompts', async () => {
    const suite = JSON.parse(await readFile(new URL('../evals/suite.json', import.meta.url), 'utf8'))
    for (const id of ['MODEL-E2E-01', 'MODEL-E2E-02']) {
      const prompt = suite.cases.find((testCase: { id: string }) => testCase.id === id).prompt
      expect(prompt).not.toMatch(/WorkSurface|run_orchestrator|\bws\b/i)
    }
  })
})
