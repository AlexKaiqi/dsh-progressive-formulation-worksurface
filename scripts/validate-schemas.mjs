import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { adaptDshToolCompleted } from '../examples/dsh-tool-completed-adapter.mjs'

const root = new URL('../', import.meta.url)
const specRoot = new URL('spec/', root)
const designRoot = new URL('design/', specRoot)

const currentAjv = createAjv()
const currentValidators = await loadSchemas(currentAjv, specRoot, [
  'event',
  'definition',
  'context',
  'binding',
  'authoring-registration',
  'code-handler-context',
  'code-handler-emit',
])
await validateCurrentFixtures(currentValidators)
await validateCurrentExamples(currentValidators.get('definition'))

const targetAjv = createAjv()
const targetValidators = await loadSchemas(targetAjv, designRoot, [
  'runtime-authority',
  'runtime-event-contract',
  'runtime-event-envelope',
  'builtin-event-catalog',
  'event-declaration',
  'runtime-binding',
  'session-shell-contract',
  'surface-turn-brief',
  'orchestrate-registration',
  'orchestrate-registration-record',
  'orchestrate-input-ledger-record',
  'orchestrate-input-record',
  'orchestrate-run-state',
  'orchestrate-result',
  'orchestrate-operation-batch',
  'orchestrate-operation-settlement',
])

const builtinCatalog = await validateBuiltinEventCatalog()
await validateSessionShellContract()
const runtimeBinding = await validateRuntimeBindings()
await validateTurnBrief()
await validateDelegate(runtimeBinding, builtinCatalog)
await validateFanoutJoin(builtinCatalog)
await validateSerialLoop(builtinCatalog)

console.log('WorkSurface current and target protocols, contracts, and executable Orchestrate examples are valid')

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv
}

async function loadSchemas(ajv, directory, names) {
  const validators = new Map()
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, directory), 'utf8'))
    if (!ajv.validateSchema(schema)) {
      throw new Error(`${name}.schema.json is not valid JSON Schema: ${ajv.errorsText()}`)
    }
    ajv.addSchema(schema)
    validators.set(name, ajv.getSchema(schema.$id))
  }
  return validators
}

async function validateCurrentFixtures(validators) {
  for (const entry of await readdir(new URL('fixtures/', specRoot), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const match = /^(event|definition|context|binding|authoring-registration|code-handler-context|code-handler-emit)\.(valid|invalid)\.[^.]+\.json$/.exec(entry.name)
    if (match === null) throw new Error(`Schema fixture '${entry.name}' does not declare schema and expectation`)
    const value = JSON.parse(await readFile(new URL(`fixtures/${entry.name}`, specRoot), 'utf8'))
    const validate = validators.get(match[1])
    const accepted = validate(value)
    if (accepted !== (match[2] === 'valid')) {
      throw new Error(`${entry.name} was ${accepted ? 'accepted' : 'rejected'} unexpectedly: ${currentAjv.errorsText(validate.errors)}`)
    }
  }
}

async function validateCurrentExamples(validateDefinition) {
  for (const entry of await readdir(new URL('examples/', root), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.definition.json')) continue
    const value = JSON.parse(await readFile(new URL(`examples/${entry.name}`, root), 'utf8'))
    if (!validateDefinition(value)) {
      throw new Error(`${entry.name} violates definition.schema.json: ${currentAjv.errorsText(validateDefinition.errors)}`)
    }
  }
}

async function validateSessionShellContract() {
  const contract = JSON.parse(await readFile(new URL('session-shell-contract.json', designRoot), 'utf8'))
  const validate = targetValidators.get('session-shell-contract')
  if (!validate(contract)) {
    throw new Error(`session-shell-contract.json violates its schema: ${targetAjv.errorsText(validate.errors)}`)
  }
  const expected = [
    'DSH_SURFACE_DIR',
    'DSH_SURFACE_ID',
    'DSH_WORKSURFACE_ROOT',
    'DSH_WORKSURFACE_VIEW_DIR',
  ]
  if (!sameJson(Object.keys(contract.variables).sort(), expected)) {
    throw new Error('Session shell Contract must expose exactly four stable variables')
  }
  if (!contract.variables.DSH_WORKSURFACE_VIEW_DIR.purpose.includes('turn-brief.json')) {
    throw new Error('Session shell Contract does not expose the fixed Turn Brief locator')
  }
  const serialized = JSON.stringify(contract)
  for (const forbidden of ['SOCKET', 'CAPABILITY', 'CONTEXT_FILE', 'WORKSURFACE_CLI', 'EVENT_NAMESPACE']) {
    if (serialized.includes(forbidden)) throw new Error(`Session shell Contract exposes Runtime transport ${forbidden}`)
  }
}

async function validateBuiltinEventCatalog() {
  const catalog = JSON.parse(await readFile(new URL('builtin-event-catalog.json', designRoot), 'utf8'))
  const validate = targetValidators.get('builtin-event-catalog')
  if (!validate(catalog)) {
    throw new Error(`builtin-event-catalog.json violates its schema: ${targetAjv.errorsText(validate.errors)}`)
  }
  const validateContract = targetValidators.get('runtime-event-contract')
  for (const [name, event] of Object.entries(catalog.events)) {
    compilePayload(`built-in Event ${name}`, event.payloadSchema)
    const contract = {
      version: 1,
      scope: { authority: 'wsa_builtin_validation', kind: 'builtin', id: catalog.scopeId },
      name,
      ...event,
    }
    if (!validateContract(contract)) {
      throw new Error(`built-in Event ${name} cannot materialize as a Runtime Contract: ${targetAjv.errorsText(validateContract.errors)}`)
    }
  }
  return catalog
}

async function validateRuntimeBindings() {
  const names = [
    'runtime-binding.surface-turn-a.json',
    'runtime-binding.surface-turn-b.json',
    'runtime-binding.orchestrate-run.json',
  ]
  const validate = targetValidators.get('runtime-binding')
  const bindings = []
  for (const name of names) {
    const binding = JSON.parse(await readFile(new URL(`examples/${name}`, root), 'utf8'))
    if (!validate(binding)) {
      throw new Error(`${name} violates runtime-binding.schema.json: ${targetAjv.errorsText(validate.errors)}`)
    }
    bindings.push(binding)
  }
  const [left, right, orchestrate] = bindings
  if (left.authority === right.authority || left.execution.surfaceId !== right.execution.surfaceId) {
    throw new Error('Surface Turn bindings do not prove authority isolation for identical local handles')
  }

  const durableContract = {
    version: 1,
    scope: { authority: left.authority, kind: 'registration', id: 'review-flow' },
    name: 'review.completed',
    description: 'One reviewer completed a review.',
    subjects: ['surface'],
    producers: ['surface-session'],
    payloadSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    },
  }
  const validateContract = targetValidators.get('runtime-event-contract')
  if (!validateContract(durableContract)) {
    throw new Error(`Runtime Event Contract example is invalid: ${targetAjv.errorsText(validateContract.errors)}`)
  }
  const durableEvent = {
    version: 1,
    id: 'event-1',
    subject: { authority: left.authority, kind: 'surface', id: left.execution.surfaceId },
    seq: 0,
    type: {
      scope: durableContract.scope,
      name: durableContract.name,
      contract: `sha256:${'a'.repeat(64)}`,
    },
    payload: {},
    causes: [],
    producer: { kind: 'surface-session', ref: left.execution.sessionId },
    operationKey: 'turn-1/review.completed',
    recordedAt: '2026-08-31T00:00:00.000Z',
  }
  const validateEvent = targetValidators.get('runtime-event-envelope')
  if (!validateEvent(durableEvent)) {
    throw new Error(`Runtime Event example is invalid: ${targetAjv.errorsText(validateEvent.errors)}`)
  }

  for (const [label, invalid] of [
    ['Surface Turn with Run identity', { ...left, execution: { ...left.execution, runId: 'run-crossed' } }],
    ['Orchestrate Run with Surface identity', { ...orchestrate, execution: { ...orchestrate.execution, surfaceId: 'surface-crossed' } }],
  ]) {
    if (validate(invalid)) throw new Error(`runtime-binding.schema.json accepts ${label}`)
  }
  return orchestrate
}

async function validateTurnBrief() {
  const brief = JSON.parse(await readFile(new URL('examples/turn-brief.review.json', root), 'utf8'))
  assertModelVisible(brief, 'turn-brief.review.json')
  const validate = targetValidators.get('surface-turn-brief')
  if (!validate(brief)) {
    throw new Error(`turn-brief.review.json violates surface-turn-brief.schema.json: ${targetAjv.errorsText(validate.errors)}`)
  }
  for (const output of brief.outputs) {
    if (!output.commandTemplate.startsWith(`ws emit ${output.name} `)) {
      throw new Error(`Turn Brief command does not exactly name ${output.name}`)
    }
  }
}

async function validateDelegate(runtimeBinding, builtinCatalog) {
  const sourceUrl = new URL('examples/orchestrate-code/delegate/', root)
  const runUrl = new URL('run/', sourceUrl)
  const registration = JSON.parse(await readFile(new URL('registration.json', sourceUrl), 'utf8'))
  validateValue('delegate/registration.json', registration, 'orchestrate-registration')
  const validateRegistration = targetValidators.get('orchestrate-registration')
  const legacyEventArray = Object.entries(registration.events).map(([name, route]) => ({ name, ...route }))
  if (validateRegistration({ ...registration, events: legacyEventArray })) {
    throw new Error('Registration accepts the redundant Event array form')
  }
  const builtinRegistration = {
    ...registration,
    events: {
      'surface.revision.published': { builtin: true, consumeFrom: ['coordinator'] },
    },
  }
  if (!validateRegistration(builtinRegistration)) {
    throw new Error(`Registration cannot reference a built-in Event: ${targetAjv.errorsText(validateRegistration.errors)}`)
  }
  const dshRegistration = {
    ...registration,
    events: {
      'dsh.tool.completed': { builtin: true, consumeFrom: ['researcher'] },
    },
  }
  if (!validateRegistration(dshRegistration)) {
    throw new Error(`Registration cannot observe the DSH tool completion adapter: ${targetAjv.errorsText(validateRegistration.errors)}`)
  }
  const dshRoutes = await loadRegistrationRoutes(dshRegistration, sourceUrl, builtinCatalog)
  const invalidCopiedBuiltin = {
    ...builtinRegistration,
    events: {
      'surface.revision.published': {
        builtin: true,
        file: 'contracts/research.requested.json',
        consumeFrom: ['coordinator'],
      },
    },
  }
  if (validateRegistration(invalidCopiedBuiltin)) {
    throw new Error('Registration can ambiguously select both built-in and file Contract sources')
  }

  const handles = Object.keys(registration.bindings)
  assertUnique(handles, 'Registration Surface handle')
  assertUnique(Object.values(registration.bindings), 'Registration Surface binding')
  if (!sameJson([...handles].sort(), Object.keys(runtimeBinding.surfaces).sort())) {
    throw new Error('Registration source and Runtime Binding expose different Surface handles')
  }

  const durable = JSON.parse(await readFile(new URL('examples/orchestrate-registration-record.delegate.json', root), 'utf8'))
  validateValue('orchestrate-registration-record.delegate.json', durable, 'orchestrate-registration-record')
  if (durable.authority !== runtimeBinding.authority || durable.registrationId !== runtimeBinding.execution.registrationId) {
    throw new Error('Durable Registration identity disagrees with Runtime Binding')
  }
  if (!sameJson(durable.surfaces, registration.bindings)) {
    throw new Error('Durable Registration Surface bindings disagree with authoring source')
  }
  if (!sameJson(Object.keys(durable.historyBoundary).sort(), [...handles].sort())) {
    throw new Error('Durable Registration does not freeze one history boundary per Surface')
  }
  const ledgerRecord = JSON.parse(await readFile(new URL('examples/orchestrate-input-ledger-record.delegate.json', root), 'utf8'))
  validateValue('orchestrate-input-ledger-record.delegate.json', ledgerRecord, 'orchestrate-input-ledger-record')
  if (ledgerRecord.authority !== durable.authority || ledgerRecord.registrationId !== durable.registrationId) {
    throw new Error('Input Ledger record is outside the durable Registration')
  }
  const ledgerSurface = Object.entries(durable.surfaces)
    .find(([, surfaceId]) => surfaceId === ledgerRecord.event.subject.id)?.[0]
  const boundaryField = ledgerRecord.event.source === 'worksurface' ? 'surfaceEventSeq' : 'dshEventSeq'
  if (ledgerSurface === undefined || ledgerRecord.event.seq <= durable.historyBoundary[ledgerSurface][boundaryField]) {
    throw new Error('Input Ledger record does not cross the registered source history boundary')
  }
  const dshEvents = JSON.parse(await readFile(new URL('examples/dsh-tool-completed.events.json', root), 'utf8'))
  const adaptedTool = adaptDshToolCompleted({
    authority: durable.authority,
    sessionId: 'session-researcher',
    events: dshEvents,
    resultSeq: 19,
  })
  const dshLedgerRecord = {
    version: 1,
    authority: durable.authority,
    registrationId: durable.registrationId,
    inputSeq: 1,
    event: adaptedTool.ref,
    acceptedAt: '2026-08-31T00:00:02.000Z',
  }
  validateValue('DSH tool Input Ledger record', dshLedgerRecord, 'orchestrate-input-ledger-record')
  const dshInput = {
    inputSeq: 1,
    surface: 'researcher',
    event: {
      name: 'dsh.tool.completed',
      payload: adaptedTool.payload,
    },
  }
  validateValue('model-visible DSH tool input', dshInput, 'orchestrate-input-record')
  validateInputs([dshInput], dshInput.inputSeq, handles, dshRoutes)

  const routes = await loadRegistrationRoutes(registration, sourceUrl, builtinCatalog)
  await readFile(new URL(registration.entrypoint, sourceUrl), 'utf8')
  validateDurableRoutes(durable, routes, runtimeBinding, handles)

  const state = JSON.parse(await readFile(new URL('state.json', runUrl), 'utf8'))
  assertModelVisible(state, 'delegate/run/state.json')
  validateValue('delegate/run/state.json', state, 'orchestrate-run-state')
  const validateState = targetValidators.get('orchestrate-run-state')
  const legacySurfaceArray = Object.entries(state.surfaces).map(([handle, path]) => ({ handle, path }))
  if (validateState({ ...state, surfaces: legacySurfaceArray })) {
    throw new Error('Run state accepts the redundant Surface array form')
  }
  assertUnique(Object.values(state.surfaces), 'run Surface path')
  if (!sameJson(Object.keys(state.surfaces).sort(), [...handles].sort())) {
    throw new Error('Run view does not materialize every registered Surface exactly once')
  }
  await validateRunContracts(state, routes, runUrl, runtimeBinding)

  const inputs = (await readFile(new URL(state.files.inputs, runUrl), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  validateInputs(inputs, state.triggerInputSeq, handles, routes)
  if (inputs[0]?.inputSeq !== ledgerRecord.inputSeq || inputs[0]?.surface !== ledgerSurface) {
    throw new Error('Model-visible input is not derived from the private Input Ledger record')
  }
  const operationBatch = JSON.parse(await readFile(new URL('examples/orchestrate-operation-batch.delegate.json', root), 'utf8'))
  const operationSettlement = JSON.parse(await readFile(new URL('examples/orchestrate-operation-settlement.delegate.json', root), 'utf8'))
  validateValue('orchestrate-operation-batch.delegate.json', operationBatch, 'orchestrate-operation-batch')
  validateValue('orchestrate-operation-settlement.delegate.json', operationSettlement, 'orchestrate-operation-settlement')
  validateOperationRecords(operationBatch, operationSettlement, durable, runtimeBinding, ledgerRecord)

  const tempRoot = await mkdtemp(join(tmpdir(), 'worksurface-delegate-example-'))
  try {
    await cp(fileURLToPath(runUrl), tempRoot, { recursive: true })
    const readOnlyBefore = new Map()
    for (const relative of ['state.json', 'inputs.jsonl', ...Object.values(state.contracts).map((contract) => contract.file)]) {
      readOnlyBefore.set(relative, await readFile(join(tempRoot, relative), 'utf8'))
    }
    const surfaceDirectoriesBefore = await directoryNames(join(tempRoot, 'surfaces'))
    execFileSync('python3', [fileURLToPath(new URL(registration.entrypoint, sourceUrl))], {
      cwd: tempRoot,
      env: { PATH: process.env.PATH ?? '' },
      stdio: 'pipe',
    })
    if (!sameJson(surfaceDirectoriesBefore, await directoryNames(join(tempRoot, 'surfaces')))) {
      throw new Error('Orchestrate code created or removed a Surface directory')
    }
    for (const [relative, content] of readOnlyBefore) {
      if (await readFile(join(tempRoot, relative), 'utf8') !== content) {
        throw new Error(`Orchestrate code modified Runtime read-only input ${relative}`)
      }
    }
    const result = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('delegate result.json', result, 'orchestrate-result')
    const validateResultSchema = targetValidators.get('orchestrate-result')
    const legacyInlineContract = {
      version: 1,
      events: [{
        surface: 'coordinator',
        name: 'temporary.created',
        contract: {
          name: 'temporary.created',
          description: 'A contract incorrectly introduced during a run.',
          payloadSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
        },
        payload: {},
      }],
      advance: [],
    }
    if (validateResultSchema(legacyInlineContract)) {
      throw new Error('Run result can mutate the admitted Event Contract set')
    }
    validateResult(result, inputs, handles, routes)
    await validateSurfaceDirectories(tempRoot, state)
    const assignment = await readFile(join(tempRoot, 'surfaces/researcher/blocks/delegation.md'), 'utf8')
    if (!assignment.includes('Find primary evidence') || !assignment.includes('case-7-market-size')) {
      throw new Error('Delegate code did not transfer coordinator context into the researcher block')
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function validateFanoutJoin(builtinCatalog) {
  const { sourceUrl, runUrl, registration, handles, routes, state, inputs: initialInputs } = await loadExecutableExample('fanout-join', builtinCatalog)

  const tempRoot = await mkdtemp(join(tmpdir(), 'worksurface-fanout-example-'))
  try {
    await cp(fileURLToPath(runUrl), tempRoot, { recursive: true })
    const originalDirectories = await directoryNames(join(tempRoot, 'surfaces'))
    const entrypoint = fileURLToPath(new URL(registration.entrypoint, sourceUrl))
    const readOnlyPaths = ['state.json', state.files.inputs, ...Object.values(state.contracts).map((contract) => contract.file)]
    const fanoutInputsBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, fanoutInputsBefore)

    if (!sameJson(originalDirectories, await directoryNames(join(tempRoot, 'surfaces')))) {
      throw new Error('Fan-out code changed the registered Surface directory set')
    }
    const fanoutResult = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('fan-out result.json', fanoutResult, 'orchestrate-result')
    validateResult(fanoutResult, initialInputs, handles, routes)
    if (!sameJson(fanoutResult.advance.map((item) => item.surface).sort(), ['explorer_a', 'explorer_b'])) {
      throw new Error('Fan-out code did not advance both registered explorers exactly once')
    }
    for (const [handle, focus] of [
      ['explorer_a', 'Find the strongest supporting case.'],
      ['explorer_b', 'Find the strongest counterexample.'],
    ]) {
      const assignment = await readFile(join(tempRoot, `surfaces/${handle}/blocks/exploration.md`), 'utf8')
      if (!assignment.includes(focus) || !assignment.includes('event-driven coordination boundary')) {
        throw new Error(`Fan-out code did not derive the correct context for ${handle}`)
      }
      await mkdir(join(tempRoot, `surfaces/${handle}/results`), { recursive: true })
      await writeFile(join(tempRoot, `surfaces/${handle}/results/exploration.md`), `${handle} detailed evidence.\n`)
    }

    const completedA = { inputSeq: 1, surface: 'explorer_a', event: { name: 'exploration.completed', payload: { taskId: 'case-8-options', resultPath: 'results/exploration.md', summary: 'Supporting case found.' } } }
    const completedB = { inputSeq: 2, surface: 'explorer_b', event: { name: 'exploration.completed', payload: { taskId: 'case-8-options', resultPath: 'results/exploration.md', summary: 'Counterexample found.' } } }
    const partialInputs = [...initialInputs, completedA]
    const partialState = { ...state, triggerInputSeq: 1 }
    await writeFile(join(tempRoot, state.files.inputs), partialInputs.map((input) => JSON.stringify(input)).join('\n') + '\n')
    await writeFile(join(tempRoot, 'state.json'), JSON.stringify(partialState, null, 2) + '\n')
    validateInputs(partialInputs, partialState.triggerInputSeq, handles, routes)
    const partialInputsBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, partialInputsBefore)
    const partialResult = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('partial join result.json', partialResult, 'orchestrate-result')
    validateResult(partialResult, partialInputs, handles, routes)
    if (partialResult.events.length !== 0 || partialResult.advance.length !== 0) {
      throw new Error('Join code advanced before every registered explorer completed')
    }

    const joinedInputs = [...partialInputs, completedB]
    await writeFile(join(tempRoot, state.files.inputs), joinedInputs.map((input) => JSON.stringify(input)).join('\n') + '\n')
    const joinState = { ...state, triggerInputSeq: 2 }
    await writeFile(join(tempRoot, 'state.json'), JSON.stringify(joinState, null, 2) + '\n')
    validateInputs(joinedInputs, joinState.triggerInputSeq, handles, routes)
    const joinInputsBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, joinInputsBefore)

    const joinResult = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('join result.json', joinResult, 'orchestrate-result')
    validateResult(joinResult, joinedInputs, handles, routes)
    if (joinResult.advance.length !== 1 || joinResult.advance[0].surface !== 'coordinator') {
      throw new Error('Join code advanced the coordinator before or beyond the complete explorer set')
    }
    const joined = await readFile(join(tempRoot, 'surfaces/coordinator/blocks/exploration-results.md'), 'utf8')
    for (const evidence of ['Supporting case found.', 'Counterexample found.', 'explorer_a detailed evidence.', 'explorer_b detailed evidence.']) {
      if (!joined.includes(evidence)) throw new Error(`Join output lost ${evidence}`)
    }
    await validateSurfaceDirectories(tempRoot, joinState)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function validateSerialLoop(builtinCatalog) {
  const { sourceUrl, runUrl, registration, handles, routes, state, inputs: initialInputs } = await loadExecutableExample('serial-loop', builtinCatalog)
  const tempRoot = await mkdtemp(join(tmpdir(), 'worksurface-serial-loop-example-'))
  try {
    await cp(fileURLToPath(runUrl), tempRoot, { recursive: true })
    const entrypoint = fileURLToPath(new URL(registration.entrypoint, sourceUrl))
    const originalDirectories = await directoryNames(join(tempRoot, 'surfaces'))
    const readOnlyPaths = ['state.json', state.files.inputs, ...Object.values(state.contracts).map((contract) => contract.file)]

    let readOnlyBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, readOnlyBefore)
    let result = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('serial start result.json', result, 'orchestrate-result')
    validateResult(result, initialInputs, handles, routes)
    if (result.advance.length !== 1 || result.advance[0].surface !== 'worker') throw new Error('Serial start did not advance worker')
    let iteration = await readFile(join(tempRoot, 'surfaces/worker/blocks/iteration.md'), 'utf8')
    if (!iteration.includes('Iteration: 1') || !iteration.includes('Remove ambiguous ownership.')) {
      throw new Error('Serial start did not transfer the first iteration context')
    }

    await mkdir(join(tempRoot, 'surfaces/worker/results'), { recursive: true })
    await writeFile(join(tempRoot, 'surfaces/worker/results/refined.md'), 'Runtime owns Event persistence; the model owns business meaning.\n')
    const incomplete = { inputSeq: 1, surface: 'worker', event: { name: 'iteration.completed', payload: { taskId: 'case-9-design', iteration: 1, converged: false, resultPath: 'results/refined.md', nextFocus: 'Make namespace ownership explicit.' } } }
    const loopInputs = [...initialInputs, incomplete]
    const loopState = { ...state, triggerInputSeq: 1 }
    await writeFile(join(tempRoot, state.files.inputs), loopInputs.map((input) => JSON.stringify(input)).join('\n') + '\n')
    await writeFile(join(tempRoot, 'state.json'), JSON.stringify(loopState, null, 2) + '\n')
    validateInputs(loopInputs, loopState.triggerInputSeq, handles, routes)
    readOnlyBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, readOnlyBefore)
    result = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('loop result.json', result, 'orchestrate-result')
    validateResult(result, loopInputs, handles, routes)
    if (result.advance.length !== 1 || result.advance[0].surface !== 'worker') throw new Error('Non-converged loop did not advance the same worker')
    iteration = await readFile(join(tempRoot, 'surfaces/worker/blocks/iteration.md'), 'utf8')
    if (!iteration.includes('Iteration: 2') || !iteration.includes('Make namespace ownership explicit.')) {
      throw new Error('Loop did not rewrite the worker context for iteration 2')
    }

    await writeFile(join(tempRoot, 'surfaces/worker/results/refined.md'), 'Runtime resolves namespaces; the model uses stable local Event names.\n')
    const converged = { inputSeq: 2, surface: 'worker', event: { name: 'iteration.completed', payload: { taskId: 'case-9-design', iteration: 2, converged: true, resultPath: 'results/refined.md' } } }
    const settledInputs = [...loopInputs, converged]
    const settledState = { ...state, triggerInputSeq: 2 }
    await writeFile(join(tempRoot, state.files.inputs), settledInputs.map((input) => JSON.stringify(input)).join('\n') + '\n')
    await writeFile(join(tempRoot, 'state.json'), JSON.stringify(settledState, null, 2) + '\n')
    validateInputs(settledInputs, settledState.triggerInputSeq, handles, routes)
    readOnlyBefore = await snapshotFiles(tempRoot, readOnlyPaths)
    execFileSync('python3', [entrypoint], { cwd: tempRoot, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' })
    await assertFilesUnchanged(tempRoot, readOnlyBefore)
    result = JSON.parse(await readFile(join(tempRoot, state.files.result), 'utf8'))
    validateValue('serial completion result.json', result, 'orchestrate-result')
    validateResult(result, settledInputs, handles, routes)
    if (result.advance.length !== 1 || result.advance[0].surface !== 'coordinator') throw new Error('Converged loop did not resume the serial coordinator')
    const returned = await readFile(join(tempRoot, 'surfaces/coordinator/blocks/refined-result.md'), 'utf8')
    if (!returned.includes('Iterations: 2') || !returned.includes('stable local Event names')) {
      throw new Error('Serial completion did not transfer the converged result')
    }
    if (!sameJson(originalDirectories, await directoryNames(join(tempRoot, 'surfaces')))) {
      throw new Error('Serial-loop code changed the registered Surface directory set')
    }
    await validateSurfaceDirectories(tempRoot, settledState)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function loadExecutableExample(name, builtinCatalog) {
  const sourceUrl = new URL(`examples/orchestrate-code/${name}/`, root)
  const runUrl = new URL('run/', sourceUrl)
  const registration = JSON.parse(await readFile(new URL('registration.json', sourceUrl), 'utf8'))
  validateValue(`${name}/registration.json`, registration, 'orchestrate-registration')
  const handles = Object.keys(registration.bindings)
  assertUnique(Object.values(registration.bindings), `${name} Registration Surface binding`)
  const routes = await loadRegistrationRoutes(registration, sourceUrl, builtinCatalog)
  const state = JSON.parse(await readFile(new URL('state.json', runUrl), 'utf8'))
  assertModelVisible(state, `${name}/run/state.json`)
  validateValue(`${name}/run/state.json`, state, 'orchestrate-run-state')
  if (!sameJson(Object.keys(state.surfaces).sort(), [...handles].sort())) {
    throw new Error(`${name} run view does not materialize every registered Surface`)
  }
  await validateRunContracts(state, routes, runUrl)
  const inputs = parseJsonLines(await readFile(new URL(state.files.inputs, runUrl), 'utf8'))
  validateInputs(inputs, state.triggerInputSeq, handles, routes)
  return { sourceUrl, runUrl, registration, handles, routes, state, inputs }
}

async function loadRegistrationRoutes(registration, sourceUrl, builtinCatalog) {
  const routes = new Map()
  const handles = Object.keys(registration.bindings)
  const builtins = new Map(Object.entries(builtinCatalog.events))
  for (const [name, route] of Object.entries(registration.events)) {
    for (const handle of routeHandles(route)) {
      if (!handles.includes(handle)) throw new Error(`Registration route ${name} references unknown Surface ${handle}`)
    }
    const sourceLabel = route.builtin === true ? `built-in ${name}` : route.file
    const catalogEvent = route.builtin === true ? builtins.get(name) : undefined
    if (route.builtin === true && catalogEvent === undefined) throw new Error(`Registration references unknown built-in Event ${name}`)
    if (route.builtin !== true && builtins.has(name)) throw new Error(`Registration shadows built-in Event ${name} with a file Contract`)
    const declaration = catalogEvent === undefined
      ? JSON.parse(await readFile(new URL(route.file, sourceUrl), 'utf8'))
      : { name, description: catalogEvent.description, payloadSchema: catalogEvent.payloadSchema }
    validateValue(sourceLabel, declaration, 'event-declaration')
    if (declaration.name !== name) throw new Error(`${sourceLabel} does not declare ${name}`)
    if (catalogEvent !== undefined && route.emitOn !== undefined && !catalogEvent.producers.includes('orchestrate')) {
      throw new Error(`built-in Event ${name} does not authorize the orchestrate producer`)
    }
    if (catalogEvent !== undefined && route.surfaceOutputFrom !== undefined && !catalogEvent.producers.includes('surface-session')) {
      throw new Error(`built-in Event ${name} does not authorize the surface-session producer`)
    }
    compilePayload(sourceLabel, declaration.payloadSchema)
    routes.set(name, { route, declaration })
  }
  return routes
}

function validateOperationRecords(batch, settlement, registration, runtimeBinding, ledgerRecord) {
  if (batch.authority !== registration.authority || batch.registrationId !== registration.registrationId
    || batch.orchestrateRevision !== registration.orchestrateRevision || batch.runId !== runtimeBinding.execution.runId
    || batch.triggerInputSeq !== ledgerRecord.inputSeq) {
    throw new Error('Recorded Operation batch identity disagrees with Registration, Run, or trigger input')
  }
  if (!batch.causes.some((cause) => sameJson(cause, ledgerRecord.event))) {
    throw new Error('Recorded Operation batch lost its trigger EventRef cause')
  }
  if (!sameJson(Object.keys(batch.surfaces).sort(), Object.keys(registration.surfaces).sort())) {
    throw new Error('Recorded Operation batch does not freeze every registered Surface')
  }
  for (const [handle, revisions] of Object.entries(batch.surfaces)) {
    if (revisions.surfaceId !== registration.surfaces[handle]) {
      throw new Error(`Recorded Operation batch misbinds Surface ${handle}`)
    }
    if (settlement.surfaceRevisions[handle] !== revisions.candidateRevision) {
      throw new Error(`Operation settlement does not expose candidate Revision for ${handle}`)
    }
  }
  if (settlement.authority !== batch.authority || settlement.registrationId !== batch.registrationId || settlement.runId !== batch.runId) {
    throw new Error('Operation settlement identity disagrees with its recorded batch')
  }
  const recordedKeys = [...batch.events, ...batch.advance].map((operation) => operation.operationKey).sort()
  const settledKeys = [...settlement.events, ...settlement.advance].map((operation) => operation.operationKey).sort()
  assertUnique(recordedKeys, 'recorded Operation key')
  assertUnique(settledKeys, 'settled Operation key')
  if (!sameJson(recordedKeys, settledKeys)) throw new Error('Operation settlement does not cover the complete recorded batch')
  for (const operation of batch.advance) {
    const binding = runtimeBinding.contracts
    for (const output of operation.outputs) {
      const local = binding[output.name]
      if (local === undefined || local.scope.kind !== output.scope.kind || local.scope.id !== output.scope.id || local.digest !== output.digest) {
        throw new Error(`Recorded advance contains unresolved Event output ${output.name}`)
      }
    }
  }
}

function validateDurableRoutes(durable, routes, runtimeBinding, handles) {
  if (Object.keys(durable.routes).length !== routes.size) throw new Error('Durable Registration routes disagree with authoring source')
  for (const [name, route] of Object.entries(durable.routes)) {
    const source = routes.get(name)?.route
    const binding = runtimeBinding.contracts[name]
    if (source === undefined || binding === undefined) throw new Error(`Durable route ${name} has no source or Runtime Binding`)
    if (route.scope.authority !== durable.authority || route.scope.kind !== binding.scope.kind || route.scope.id !== binding.scope.id || route.digest !== binding.digest) {
      throw new Error(`Durable route ${name} has inconsistent Contract identity`)
    }
    for (const handle of routeHandles(route)) {
      if (!handles.includes(handle)) throw new Error(`Durable route ${name} references unknown Surface ${handle}`)
    }
    for (const capability of ['consumeFrom', 'emitOn', 'surfaceOutputFrom']) {
      if (!sameJson([...(route[capability] ?? [])].sort(), [...(source[capability] ?? [])].sort())) {
        throw new Error(`Durable route ${name}.${capability} disagrees with authoring source`)
      }
    }
  }
}

async function validateRunContracts(state, routes, runUrl, runtimeBinding) {
  for (const [name, contract] of Object.entries(state.contracts)) {
    const source = routes.get(name)
    const binding = runtimeBinding?.contracts[name]
    if (source === undefined || (runtimeBinding !== undefined && binding === undefined)) throw new Error(`Run exposes unregistered Event ${name}`)
    const expected = [
      ...(source.route.consumeFrom === undefined ? [] : ['consume']),
      ...(source.route.emitOn === undefined ? [] : ['orchestrate-emit']),
      ...(source.route.surfaceOutputFrom === undefined ? [] : ['surface-output']),
    ].sort()
    if (!sameJson([...contract.capabilities].sort(), expected)
      || (binding !== undefined && !sameJson([...binding.capabilities].sort(), expected))) {
      throw new Error(`Run exposes incorrect capabilities for ${name}`)
    }
    const declaration = JSON.parse(await readFile(new URL(contract.file, runUrl), 'utf8'))
    validateValue(contract.file, declaration, 'event-declaration')
    if (declaration.name !== name) throw new Error(`${contract.file} does not declare ${name}`)
    if (!sameJson(declaration, source.declaration)) throw new Error(`${contract.file} differs from its admitted Contract source`)
  }
}

function validateInputs(inputs, triggerInputSeq, handles, routes) {
  const seen = new Set()
  let previous = -1
  for (const input of inputs) {
    validateValue('delegate input', input, 'orchestrate-input-record')
    if (seen.has(input.inputSeq) || input.inputSeq <= previous) throw new Error('Input Ledger sequence is not unique and increasing')
    seen.add(input.inputSeq)
    previous = input.inputSeq
    if (!handles.includes(input.surface)) throw new Error(`Input references unbound Surface ${input.surface}`)
    const contract = routes.get(input.event.name)
    if (contract === undefined || !(contract.route.consumeFrom ?? []).includes(input.surface)) {
      throw new Error(`Input ${input.event.name} is not routed from ${input.surface}`)
    }
    const validatePayload = compilePayload(input.event.name, contract.declaration.payloadSchema)
    if (!validatePayload(input.event.payload)) throw new Error(`Input payload violates ${input.event.name}`)
  }
  if (!seen.has(triggerInputSeq)) throw new Error('triggerInputSeq does not exist in the Input Ledger')
}

function validateResult(result, inputs, handles, routes) {
  const inputSeqs = new Set(inputs.map((input) => input.inputSeq))
  const operationKeys = new Set()
  assertCauses(result.causes ?? [], inputSeqs, 'result')
  for (const event of result.events) {
    if (!handles.includes(event.surface)) throw new Error(`Result Event targets unbound Surface ${event.surface}`)
    assertCauses(event.causes ?? result.causes ?? [], inputSeqs, `Event ${event.name}`)
    assertUniqueKey(event.key, operationKeys)
    const routed = routes.get(event.name)
    if (routed === undefined || !(routed.route.emitOn ?? []).includes(event.surface)) {
      throw new Error(`Result Event ${event.name} is not authorized on ${event.surface}`)
    }
    const validatePayload = compilePayload(event.name, routed.declaration.payloadSchema)
    if (!validatePayload(event.payload)) throw new Error(`Result Event payload violates ${event.name}`)
  }
  for (const advance of result.advance) {
    if (!handles.includes(advance.surface)) throw new Error(`Advance targets unbound Surface ${advance.surface}`)
    assertCauses(advance.causes ?? result.causes ?? [], inputSeqs, `advance ${advance.surface}`)
    assertUniqueKey(advance.key, operationKeys)
    for (const output of advance.outputs) {
      const routed = routes.get(output)
      if (routed === undefined || !(routed.route.surfaceOutputFrom ?? []).includes(advance.surface)) {
        throw new Error(`Advance allows unauthorized Surface output ${output} from ${advance.surface}`)
      }
    }
  }
}

async function validateSurfaceDirectories(tempRoot, state) {
  const required = [
    '# Goal',
    '# Acceptance Criteria',
    '# Known Facts and Constraints',
    '# Assumptions',
    '# Open Questions',
    '# Current Decisions',
    '# Deliverables and Evidence',
  ]
  for (const [handle, path] of Object.entries(state.surfaces)) {
    const contents = await readFile(join(tempRoot, path, 'surface.md'), 'utf8')
    const positions = required.map((section) => contents.indexOf(section))
    if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
      throw new Error(`Orchestrate code left ${handle} with invalid surface.md`)
    }
  }
}

function validateValue(label, value, schemaName) {
  const validate = targetValidators.get(schemaName)
  if (!validate(value)) throw new Error(`${label} violates ${schemaName}.schema.json: ${targetAjv.errorsText(validate.errors)}`)
}

function compilePayload(label, schema) {
  const ajv = createAjv()
  try {
    return ajv.compile(schema)
  } catch (error) {
    throw new Error(`${label} contains invalid payload JSON Schema: ${error.message}`)
  }
}

function assertModelVisible(value, label) {
  const forbidden = new Set([
    'authority', 'scope', 'digest', 'surfaceId', 'sessionId', 'turnId',
    'registrationId', 'runId', 'revision', 'subject', 'producer',
    'operationKey', 'recordedAt',
  ])
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit)
    if (candidate === null || typeof candidate !== 'object') return
    for (const [key, child] of Object.entries(candidate)) {
      if (forbidden.has(key)) throw new Error(`${label} leaks Runtime-private field ${key}`)
      visit(child)
    }
  }
  visit(value)
}

function routeHandles(route) {
  return [...(route.consumeFrom ?? []), ...(route.emitOn ?? []), ...(route.surfaceOutputFrom ?? [])]
}

function assertCauses(causes, inputSeqs, label) {
  for (const cause of causes) {
    if (!inputSeqs.has(cause)) throw new Error(`${label} references unknown input cause ${cause}`)
  }
}

function assertUniqueKey(key, seen) {
  if (key === undefined) return
  if (seen.has(key)) throw new Error(`Result repeats explicit operation key ${key}`)
  seen.add(key)
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} is not unique`)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseJsonLines(text) {
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function snapshotFiles(rootPath, relativePaths) {
  return new Map(await Promise.all(relativePaths.map(async (relative) => [relative, await readFile(join(rootPath, relative), 'utf8')])))
}

async function assertFilesUnchanged(rootPath, snapshot) {
  for (const [relative, content] of snapshot) {
    if (await readFile(join(rootPath, relative), 'utf8') !== content) {
      throw new Error(`Orchestrate code modified Runtime read-only input ${relative}`)
    }
  }
}

async function directoryNames(path) {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
