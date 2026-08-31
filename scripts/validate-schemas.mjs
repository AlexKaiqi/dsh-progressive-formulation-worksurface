import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const root = new URL('../', import.meta.url)
const spec = new URL('spec/', root)
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

const validators = new Map()
for (const name of ['event', 'definition', 'context', 'binding', 'authoring-registration', 'code-handler-context', 'code-handler-emit']) {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, spec), 'utf8'))
  if (!ajv.validateSchema(schema)) throw new Error(`${name}.schema.json is not a valid JSON Schema: ${ajv.errorsText()}`)
  validators.set(name, ajv.compile(schema))
}

for (const entry of await readdir(new URL('fixtures/', spec), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue
  const match = /^(event|definition|context|binding|authoring-registration|code-handler-context|code-handler-emit)\.(valid|invalid)\.[^.]+\.json$/.exec(entry.name)
  if (match === null) throw new Error(`Schema fixture '${entry.name}' does not declare schema and expectation`)
  const value = JSON.parse(await readFile(new URL(`fixtures/${entry.name}`, spec), 'utf8'))
  const validate = validators.get(match[1])
  const accepted = validate(value)
  if (accepted !== (match[2] === 'valid')) {
    throw new Error(`${entry.name} was ${accepted ? 'accepted' : 'rejected'} unexpectedly: ${ajv.errorsText(validate.errors)}`)
  }
}

for (const entry of await readdir(new URL('examples/', root), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.definition.json')) continue
  const value = JSON.parse(await readFile(new URL(`examples/${entry.name}`, root), 'utf8'))
  const validate = validators.get('definition')
  if (!validate(value)) throw new Error(`${entry.name} violates definition.schema.json: ${ajv.errorsText(validate.errors)}`)
}

const designRoot = new URL('design/', spec)
const designAjv = new Ajv2020({ allErrors: true, strict: true })
addFormats(designAjv)
const designValidators = new Map()
for (const name of ['event-contract', 'orchestrate-code-binding', 'definition-v2', 'delivery-context', 'orchestrate-code-host', 'orchestrate-code-context', 'orchestrate-effect']) {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, designRoot), 'utf8'))
  if (!designAjv.validateSchema(schema)) throw new Error(`design/${name}.schema.json is not a valid JSON Schema: ${designAjv.errorsText()}`)
  designAjv.addSchema(schema)
  designValidators.set(name, designAjv.getSchema(schema.$id))
}

for (const entry of await readdir(new URL('fixtures/', designRoot), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue
  const match = /^(event-contract|orchestrate-code-binding|definition-v2|delivery-context|orchestrate-code-host|orchestrate-code-context|orchestrate-effect)\.(valid|invalid)\.[^.]+\.json$/.exec(entry.name)
  if (match === null) throw new Error(`Design fixture '${entry.name}' does not declare schema and expectation`)
  const value = JSON.parse(await readFile(new URL(`fixtures/${entry.name}`, designRoot), 'utf8'))
  const validate = designValidators.get(match[1])
  const accepted = validate(value)
  if (accepted !== (match[2] === 'valid')) {
    throw new Error(`${entry.name} was ${accepted ? 'accepted' : 'rejected'} unexpectedly: ${designAjv.errorsText(validate.errors)}`)
  }
  if (accepted) validateEmbeddedPayloadSchemas(entry.name, value)
}

const hostContract = JSON.parse(await readFile(new URL('orchestrate-code-host.json', designRoot), 'utf8'))
const validateHostContract = designValidators.get('orchestrate-code-host')
if (!validateHostContract(hostContract)) {
  throw new Error(`design/orchestrate-code-host.json violates its schema: ${designAjv.errorsText(validateHostContract.errors)}`)
}

await validateCodeExamples()

console.log('WorkSurface current and target-design JSON Schemas and fixtures are valid')

async function validateCodeExamples() {
  const definitionUrl = new URL('examples/orchestrate-code/patterns.definition-v2.json', root)
  const definition = JSON.parse(await readFile(definitionUrl, 'utf8'))
  const validateDefinition = designValidators.get('definition-v2')
  if (!validateDefinition(definition)) {
    throw new Error(`patterns.definition-v2.json violates target Definition v2: ${designAjv.errorsText(validateDefinition.errors)}`)
  }
  validateEmbeddedPayloadSchemas('patterns.definition-v2.json', definition)

  const cases = [
    { subscription: 'delegate-research', env: { TASK_ID: 'task-7', QUESTION: 'What is the contract?' }, expected: ['followup:researcher'] },
    { subscription: 'serial-stage-c', env: { CASE_ID: 'case-7', PREPARED_REF: 'surface://stage-b/prepared.md' }, expected: ['followup:stage-c'] },
    { subscription: 'fanout-review', env: { CASE_ID: 'case-7', QUESTION: 'Review the design.' }, expected: ['followup:reviewer-a', 'followup:reviewer-b'] },
    { subscription: 'join-review', env: { CASE_ID: 'case-7', REVIEW_A_REF: 'surface://reviewer-a/review.md', REVIEW_B_REF: 'surface://reviewer-b/review.md' }, expected: ['emit:coordinator:review.joined'] },
    { subscription: 'advance-loop', env: { CASE_ID: 'case-7', ITERATION: '2', CONVERGED: 'false' }, expected: ['emit:worker:iteration.requested'] },
    { subscription: 'advance-loop', env: { CASE_ID: 'case-7', ITERATION: '3', CONVERGED: 'true' }, expected: ['emit:coordinator:workflow.completed'] },
  ]
  const effectValidator = designValidators.get('orchestrate-effect')
  const tempRoot = await mkdtemp(join(tmpdir(), 'worksurface-code-examples-'))
  try {
    for (const [index, testCase] of cases.entries()) {
      const subscription = definition.subscriptions.find((candidate) => candidate.id === testCase.subscription)
      if (subscription === undefined || subscription.reaction.code === undefined) {
        throw new Error(`Code example references missing subscription ${testCase.subscription}`)
      }
      const code = subscription.reaction.code
      const declared = Object.keys(code.env ?? {}).sort()
      const supplied = Object.keys(testCase.env).sort()
      if (JSON.stringify(declared) !== JSON.stringify(supplied)) {
        throw new Error(`${testCase.subscription} injected variables do not equal its Definition declaration`)
      }
      const scriptUrl = new URL(code.path, root)
      const script = await readFile(scriptUrl, 'utf8')
      if (script.includes('DSH_CONTEXT_FILE')) {
        throw new Error(`${code.path} reads the full context fallback instead of declared direct variables`)
      }
      const effectsPath = join(tempRoot, `${index}.jsonl`)
      execFileSync(code.command, [fileURLToPath(scriptUrl), ...(code.args ?? [])], {
        cwd: fileURLToPath(root),
        env: {
          PATH: process.env.PATH,
          ...testCase.env,
          WS_ACTIVATION_ID: `activation-${index}`,
          WS_ACTIVATION_KEY: testCase.env.CASE_ID ?? testCase.env.TASK_ID,
          WS_REGISTRATION_ID: 'registration-examples',
          WS_DEFINITION_REVISION: `sha256:${'a'.repeat(64)}`,
          WS_SUBSCRIPTION_ID: testCase.subscription,
          WS_EFFECTS_FILE: effectsPath,
        },
        stdio: 'pipe',
      })
      const records = (await readFile(effectsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
      const seenKeys = new Set()
      for (const record of records) {
        if (!effectValidator(record)) {
          throw new Error(`${code.path} emitted an invalid effect: ${designAjv.errorsText(effectValidator.errors)}`)
        }
        if (seenKeys.has(record.operationKey)) throw new Error(`${code.path} emitted duplicate operationKey ${record.operationKey}`)
        seenKeys.add(record.operationKey)
        assertEffectCapability(definition, code.effects, record)
      }
      const actual = records.map((record) => record.kind === 'emit'
        ? `emit:${record.role}:${record.event}`
        : `followup:${record.role}`)
      if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
        throw new Error(`${code.path} emitted ${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.expected)}`)
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function assertEffectCapability(definition, capabilities, effect) {
  if (effect.kind === 'emit') {
    const allowed = (capabilities.emit ?? []).some((candidate) => candidate.role === effect.role && candidate.event === effect.event)
    if (!allowed) throw new Error(`Effect emit ${effect.role}/${effect.event} is not declared by the code reaction`)
    const contract = definition.events.find((candidate) => candidate.name === effect.event)
    if (contract === undefined) throw new Error(`Effect emit references undeclared Event Contract ${effect.event}`)
    const payloadAjv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(payloadAjv)
    const validatePayload = payloadAjv.compile(contract.payloadSchema)
    if (!validatePayload(effect.payload)) {
      throw new Error(`Effect emit ${effect.event} violates its payload contract: ${payloadAjv.errorsText(validatePayload.errors)}`)
    }
    return
  }
  const allowed = (capabilities.followup ?? []).some((candidate) => candidate.role === effect.role)
  if (!allowed) throw new Error(`Effect followup ${effect.role} is not declared by the code reaction`)
}

function validateEmbeddedPayloadSchemas(label, value) {
  const contracts = value.version === 2 && Array.isArray(value.events)
    ? value.events
    : Array.isArray(value.eventContracts)
      ? value.eventContracts
    : value.payloadSchema === undefined
      ? Array.isArray(value.allowedOutputs) ? value.allowedOutputs : []
      : [value]
  for (const contract of contracts) {
    const payload = new Ajv2020({ allErrors: true, strict: true })
    addFormats(payload)
    const validate = payload.compile(contract.payloadSchema)
    for (const example of contract.examples ?? []) {
      if (!validate(example)) throw new Error(`${label} contains an invalid payload example: ${payload.errorsText(validate.errors)}`)
    }
  }
}
