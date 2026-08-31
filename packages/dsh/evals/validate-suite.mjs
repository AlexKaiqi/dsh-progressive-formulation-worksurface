import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function validateModelSuite(suite) {
  const required = ['history-key-and-activation-replay', 'operation-intent-and-settlement-recovery', 'session-turn-authoring-recovery', 'turn-capability-and-publication-cas', 'handler-event-api-boundary', 'cli-and-service-equivalence']
  if (suite?.version !== 1 || !Array.isArray(suite?.cases)) return ['invalid suite']
  const errors = required.filter(id => !suite.cases.some(item => item?.id === id)).map(id => `missing ${id}`)
  for (const item of suite.cases) {
    if (typeof item?.id !== 'string' || typeof item?.testFile !== 'string' || !item.testFile.startsWith('tests/')) {
      errors.push('each case must name a tests/ behavior file')
    }
    const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
    if (typeof item?.testFile === 'string' && !existsSync(`${workspaceRoot}packages/dsh/${item.testFile}`)) errors.push(`missing ${item.testFile}`)
  }
  return errors
}

export function runModelSuite(suite) {
  const errors = validateModelSuite(suite)
  if (errors.length) return { status: 1, errors }
  const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url))
  const testFiles = [...new Set(suite.cases.map(item => `packages/dsh/${item.testFile}`))]
  const result = spawnSync(process.execPath, [vitest, 'run', ...testFiles, '--config', `${workspaceRoot}vitest.config.ts`], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  return { status: result.status ?? 1, errors: result.error === undefined ? [] : [String(result.error)] }
}

const suite = JSON.parse(await readFile(new URL('./suite.json', import.meta.url), 'utf8'))
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runModelSuite(suite)
  if (result.errors.length) result.errors.forEach(console.error)
  process.exitCode = result.status
}
