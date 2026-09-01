import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  automatedEvidenceFiles,
  checkGeneratedReadinessDocument,
  loadModelReadiness,
  validateModelReadiness,
} from './model-readiness-matrix.mjs'

const modelReadiness = await loadModelReadiness()

export function validateModelSuite(suite, readiness = modelReadiness) {
  const required = ['history-key-and-activation-replay', 'operation-intent-and-settlement-recovery', 'session-turn-authoring-recovery', 'turn-capability-and-publication-cas', 'handler-event-api-boundary', 'cli-and-service-equivalence', 'model-worksurface-readiness']
  if (suite?.version !== 1 || !Array.isArray(suite?.cases)) return ['invalid suite']
  const errors = [
    ...required.filter(id => !suite.cases.some(item => item?.id === id)).map(id => `missing ${id}`),
    ...validateModelReadiness(readiness),
  ]
  for (const item of suite.cases) {
    if (typeof item?.id !== 'string' || typeof item?.testFile !== 'string' || !item.testFile.startsWith('tests/')) {
      errors.push('each case must name a tests/ behavior file')
    }
    const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
    if (typeof item?.testFile === 'string' && !existsSync(`${workspaceRoot}packages/dsh/${item.testFile}`)) errors.push(`missing ${item.testFile}`)
  }
  return errors
}

export function runModelSuite(suite, readiness = modelReadiness) {
  const errors = validateModelSuite(suite, readiness)
  if (errors.length) return { status: 1, errors }
  const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url))
  const testFiles = [...new Set([
    ...suite.cases.map(item => `packages/dsh/${item.testFile}`),
    ...automatedEvidenceFiles(readiness),
  ])]
  const result = spawnSync(process.execPath, [vitest, 'run', ...testFiles, '--config', `${workspaceRoot}vitest.config.ts`], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  return { status: result.status ?? 1, errors: result.error === undefined ? [] : [String(result.error)] }
}

const suite = JSON.parse(await readFile(new URL('./suite.json', import.meta.url), 'utf8'))
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const validationErrors = validateModelSuite(suite, modelReadiness)
  const generatedCurrent = validationErrors.length === 0 && await checkGeneratedReadinessDocument(modelReadiness)
  const result = validationErrors.length > 0
    ? { status: 1, errors: validationErrors }
    : generatedCurrent
      ? runModelSuite(suite, modelReadiness)
      : { status: 1, errors: ['docs/model-readiness-coverage.md is stale; regenerate it from model-readiness.json'] }
  if (result.errors.length) result.errors.forEach(console.error)
  process.exitCode = result.status
}
