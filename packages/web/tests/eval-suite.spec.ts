import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
// The validator is intentionally executable as plain Node.js in packaged eval assets.
// @ts-expect-error no declaration file is needed for the internal evaluator
import { validateRun, validateSuite } from '../evals/validate-suite.mjs'

const readJson = async (url: URL) => JSON.parse(await readFile(url, 'utf8'))

describe('WorkSurface Web E2E evaluation contract', () => {
  test('keeps every evaluation dimension covered by a structured E2E case', async () => {
    const suite = await readJson(new URL('../evals/suite.json', import.meta.url))
    expect(validateSuite(suite)).toEqual([])
    expect(suite.cases.filter((testCase: { tier: string }) => testCase.tier === 'release')).toHaveLength(7)
    expect(suite.cases.find((testCase: { id: string }) => testCase.id === 'E2E-07')).toMatchObject({
      tier: 'extended',
      validates: expect.arrayContaining(['agent-lifecycle']),
    })
  })

  test('keeps the recorded real-DSH run aligned with its suite version and release gate', async () => {
    const suite = await readJson(new URL('../evals/snapshots/suite-1.0.0.json', import.meta.url))
    const run = await readJson(new URL('../evals/runs/2026-08-20-local-dsh-rc7.json', import.meta.url))
    expect(validateRun(run, suite)).toEqual([])
    expect(run.results.filter((result: { status: string }) => result.status === 'passed')).toHaveLength(6)
    expect(run.results.find((result: { caseId: string }) => result.caseId === 'E2E-07')).toMatchObject({ status: 'not_run' })
  })

  test('keeps density and refresh stability as an explicit release case', async () => {
    const suite = await readJson(new URL('../evals/suite.json', import.meta.url))
    expect(suite.cases.find((testCase: { id: string }) => testCase.id === 'E2E-08')).toMatchObject({
      tier: 'release',
      validates: ['information-density', 'refresh-stability'],
    })
  })

  test('pins the release fixture to two semantic information dependencies', async () => {
    const suite = await readJson(new URL('../evals/suite.json', import.meta.url))
    expect(suite.fixture).toMatchObject({
      rootSurface: 'ws-eval-root',
      nodes: ['ws-eval-root', 'ws-eval-source', 'ws-eval-target'],
      edges: [
        { source: 'ws-eval-root', target: 'ws-eval-target', block: 'root_fact' },
        { source: 'ws-eval-source', target: 'ws-eval-target', block: 'source_fact' },
      ],
    })
  })
})
