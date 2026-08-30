import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function validateSuite(suite) {
  const errors = []
  if (suite?.version !== 1) errors.push('version must be 1')
  if (!Array.isArray(suite?.cases) || suite.cases.length < 3) errors.push('at least three projection cases are required')
  for (const item of suite?.cases ?? []) {
    if (!item.id || !Array.isArray(item.assertions) || item.assertions.length === 0) errors.push('each case needs assertions')
    if (typeof item.testFile !== 'string' || !item.testFile.startsWith('tests/')) errors.push('each case needs an executable tests/ file')
  }
  return errors
}

export function runSuite(suite) {
  const errors = validateSuite(suite)
  if (errors.length) return { status: 1, errors }
  const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url))
  const testFiles = [...new Set(suite.cases.map(item => `packages/web/${item.testFile}`))]
  const result = spawnSync(process.execPath, [vitest, 'run', ...testFiles, '--config', `${workspaceRoot}vitest.config.ts`], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  return { status: result.status ?? 1, errors: result.error === undefined ? [] : [String(result.error)] }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runSuite(JSON.parse(await readFile(new URL('./suite.json', import.meta.url), 'utf8')))
  if (result.errors.length) result.errors.forEach(console.error)
  process.exitCode = result.status
}
