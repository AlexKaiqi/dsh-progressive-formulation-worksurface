import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const text = value => typeof value === 'string' && value.trim() !== ''

export function validateModelSuite(suite) {
  const errors = []
  if (suite?.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!text(suite?.id) || !text(suite?.version) || !text(suite?.objective)) errors.push('id, version, and objective are required')
  if (!text(suite?.runnerContract?.environment) || !text(suite?.runnerContract?.result) || !text(suite?.runnerContract?.releaseGate)) {
    errors.push('runnerContract must define environment, result, and releaseGate')
  }
  const dimensions = Array.isArray(suite?.dimensions) ? suite.dimensions : []
  const dimensionIds = new Set()
  for (const dimension of dimensions) {
    if (!text(dimension?.id) || !text(dimension?.validates)) errors.push('every dimension needs id and validates')
    else if (dimensionIds.has(dimension.id)) errors.push(`duplicate dimension '${dimension.id}'`)
    else dimensionIds.add(dimension.id)
  }
  const covered = new Set()
  const caseIds = new Set()
  for (const testCase of suite?.cases ?? []) {
    if (!/^MODEL-E2E-\d{2}$/.test(testCase?.id ?? '')) errors.push(`invalid case id '${testCase?.id ?? '?'}'`)
    else if (caseIds.has(testCase.id)) errors.push(`duplicate case '${testCase.id}'`)
    else caseIds.add(testCase.id)
    if (!['release', 'benchmark'].includes(testCase?.tier)) errors.push(`case '${testCase?.id ?? '?'}' has invalid tier`)
    for (const field of ['title', 'purpose', 'prompt']) if (!text(testCase?.[field])) errors.push(`case '${testCase?.id ?? '?'}' needs ${field}`)
    if (!Number.isSafeInteger(testCase?.trials) || testCase.trials < 1) errors.push(`case '${testCase?.id ?? '?'}' needs positive trials`)
    if (!Array.isArray(testCase?.validates) || testCase.validates.length === 0) errors.push(`case '${testCase?.id ?? '?'}' must cover dimensions`)
    for (const dimension of testCase?.validates ?? []) {
      if (!dimensionIds.has(dimension)) errors.push(`case '${testCase?.id ?? '?'}' references unknown dimension '${dimension}'`)
      covered.add(dimension)
    }
    const criteria = Array.isArray(testCase?.criteria) ? testCase.criteria : []
    const criterionIds = new Set()
    for (const criterion of criteria) {
      if (!text(criterion?.id) || !text(criterion?.expect)) errors.push(`case '${testCase?.id ?? '?'}' has incomplete criterion`)
      else if (criterionIds.has(criterion.id)) errors.push(`case '${testCase?.id ?? '?'}' duplicates criterion '${criterion.id}'`)
      else criterionIds.add(criterion.id)
    }
    if (criteria.length < 2) errors.push(`case '${testCase?.id ?? '?'}' needs at least two criteria`)
    if (testCase?.tier === 'benchmark' && (typeof testCase?.threshold?.casePassRate !== 'number' || typeof testCase?.threshold?.criticalCriterionPassRate !== 'number')) {
      errors.push(`benchmark case '${testCase?.id ?? '?'}' needs numeric thresholds`)
    }
  }
  if (caseIds.size === 0) errors.push('suite needs model E2E cases')
  for (const id of dimensionIds) if (!covered.has(id)) errors.push(`dimension '${id}' is not covered`)
  return errors
}

async function main() {
  const suite = JSON.parse(await readFile(resolve(directory, 'suite.json'), 'utf8'))
  const errors = validateModelSuite(suite)
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`validated ${suite.cases.length} model E2E cases across ${suite.dimensions.length} dimensions`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
