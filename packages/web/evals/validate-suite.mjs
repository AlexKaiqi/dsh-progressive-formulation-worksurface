import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const nonEmpty = value => typeof value === 'string' && value.trim() !== ''

/** Validate the versioned E2E evaluation contract. */
export function validateSuite(suite) {
  const errors = []
  if (suite?.schemaVersion !== 1) errors.push('suite.schemaVersion must be 1')
  if (!nonEmpty(suite?.id)) errors.push('suite.id is required')
  if (!nonEmpty(suite?.version)) errors.push('suite.version is required')
  if (!nonEmpty(suite?.objective)) errors.push('suite.objective is required')

  const dimensions = Array.isArray(suite?.dimensions) ? suite.dimensions : []
  const dimensionIds = new Set()
  for (const dimension of dimensions) {
    if (!nonEmpty(dimension?.id)) errors.push('every dimension needs an id')
    else if (dimensionIds.has(dimension.id)) errors.push(`duplicate dimension '${dimension.id}'`)
    else dimensionIds.add(dimension.id)
    if (!nonEmpty(dimension?.validates)) errors.push(`dimension '${dimension?.id ?? '?'}' needs a validates statement`)
  }
  if (dimensions.length === 0) errors.push('suite must define at least one evaluation dimension')

  const cases = Array.isArray(suite?.cases) ? suite.cases : []
  const caseIds = new Set()
  const coveredDimensions = new Set()
  for (const testCase of cases) {
    const id = testCase?.id
    if (!/^E2E-\d{2}$/.test(id ?? '')) errors.push(`invalid case id '${id ?? '?'}'`)
    else if (caseIds.has(id)) errors.push(`duplicate case '${id}'`)
    else caseIds.add(id)
    if (!nonEmpty(testCase?.title)) errors.push(`case '${id ?? '?'}' needs a title`)
    if (!nonEmpty(testCase?.purpose)) errors.push(`case '${id ?? '?'}' needs a purpose`)
    if (!['release', 'extended'].includes(testCase?.tier)) errors.push(`case '${id ?? '?'}' has an invalid tier`)
    if (!Array.isArray(testCase?.preconditions) || testCase.preconditions.length === 0 || testCase.preconditions.some(value => !nonEmpty(value))) {
      errors.push(`case '${id ?? '?'}' needs non-empty preconditions`)
    }
    if (!Array.isArray(testCase?.validates) || testCase.validates.length === 0) errors.push(`case '${id ?? '?'}' must cover a dimension`)
    for (const dimension of testCase?.validates ?? []) {
      if (!dimensionIds.has(dimension)) errors.push(`case '${id ?? '?'}' references unknown dimension '${dimension}'`)
      coveredDimensions.add(dimension)
    }
    if (!Array.isArray(testCase?.steps) || testCase.steps.length < 2) errors.push(`case '${id ?? '?'}' needs at least two E2E steps`)
    for (const [index, step] of (testCase?.steps ?? []).entries()) {
      if (!nonEmpty(step?.action) || !nonEmpty(step?.expect)) errors.push(`case '${id ?? '?'}' step ${index + 1} needs action and expect`)
    }
    if (!Array.isArray(testCase?.evidence) || testCase.evidence.length === 0 || testCase.evidence.some(value => !nonEmpty(value))) {
      errors.push(`case '${id ?? '?'}' needs explicit evidence`)
    }
  }
  if (cases.length === 0) errors.push('suite must define at least one E2E case')
  for (const dimension of dimensionIds) if (!coveredDimensions.has(dimension)) errors.push(`dimension '${dimension}' is not covered by any case`)
  return errors
}

/** Validate one immutable execution record against its suite version. */
export function validateRun(run, suite) {
  const errors = []
  if (run?.schemaVersion !== 1) errors.push('run.schemaVersion must be 1')
  if (run?.suiteId !== suite?.id) errors.push('run.suiteId does not match suite.id')
  if (run?.suiteVersion !== suite?.version) errors.push('run.suiteVersion does not match suite.version')
  if (!nonEmpty(run?.executedAt) || Number.isNaN(Date.parse(run.executedAt))) errors.push('run.executedAt must be an ISO date')
  if (typeof run?.environment !== 'object' || run.environment === null) errors.push('run.environment is required')

  const cases = new Map((suite?.cases ?? []).map(testCase => [testCase.id, testCase]))
  const results = Array.isArray(run?.results) ? run.results : []
  const seen = new Set()
  for (const result of results) {
    if (!cases.has(result?.caseId)) errors.push(`run references unknown case '${result?.caseId ?? '?'}'`)
    else if (seen.has(result.caseId)) errors.push(`run duplicates case '${result.caseId}'`)
    else seen.add(result.caseId)
    if (!['passed', 'failed', 'blocked', 'not_run'].includes(result?.status)) errors.push(`case '${result?.caseId ?? '?'}' has invalid run status`)
    if (!Array.isArray(result?.observations) || result.observations.length === 0 || result.observations.some(value => !nonEmpty(value))) {
      errors.push(`case '${result?.caseId ?? '?'}' needs run observations`)
    }
  }
  for (const [id, testCase] of cases) {
    if (!seen.has(id)) errors.push(`run is missing case '${id}'`)
    const result = results.find(item => item.caseId === id)
    if (testCase.tier === 'release' && result?.status !== 'passed') errors.push(`release case '${id}' must pass in a recorded release run`)
  }
  return errors
}

async function main() {
  const suite = JSON.parse(await readFile(resolve(directory, 'suite.json'), 'utf8'))
  const errors = validateSuite(suite)
  const suitesByVersion = new Map([[suite.version, suite]])
  const snapshotDirectory = resolve(directory, 'snapshots')
  for (const name of (await readdir(snapshotDirectory)).filter(name => name.endsWith('.json')).sort()) {
    const snapshot = JSON.parse(await readFile(resolve(snapshotDirectory, name), 'utf8'))
    errors.push(...validateSuite(snapshot).map(error => `${name}: ${error}`))
    if (suitesByVersion.has(snapshot.version)) errors.push(`${name}: duplicate suite version '${snapshot.version}'`)
    else suitesByVersion.set(snapshot.version, snapshot)
  }
  const runDirectory = resolve(directory, 'runs')
  for (const name of (await readdir(runDirectory)).filter(name => name.endsWith('.json')).sort()) {
    const run = JSON.parse(await readFile(resolve(runDirectory, name), 'utf8'))
    const runSuite = suitesByVersion.get(run.suiteVersion)
    if (!runSuite) errors.push(`${name}: no suite snapshot for version '${run.suiteVersion}'`)
    else errors.push(...validateRun(run, runSuite).map(error => `${name}: ${error}`))
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log(`validated ${suite.cases.length} current E2E cases across ${suite.dimensions.length} dimensions and ${suitesByVersion.size - 1} archived suite version(s)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
