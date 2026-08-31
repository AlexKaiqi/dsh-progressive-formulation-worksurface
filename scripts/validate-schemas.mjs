import { readdir, readFile } from 'node:fs/promises'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse as parseYaml } from 'yaml'

const root = new URL('../', import.meta.url)
const spec = new URL('spec/', root)
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

const validators = new Map()
for (const name of ['event', 'definition', 'context', 'binding', 'authoring-registration']) {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, spec), 'utf8'))
  if (!ajv.validateSchema(schema)) throw new Error(`${name}.schema.json is not a valid JSON Schema: ${ajv.errorsText()}`)
  validators.set(name, ajv.compile(schema))
}

const authoringSchema = parseYaml(await readFile(new URL('orchestration-authoring.schema.yaml', spec), 'utf8'))
if (!ajv.validateSchema(authoringSchema)) throw new Error(`orchestration-authoring.schema.yaml is not a valid JSON Schema: ${ajv.errorsText()}`)
validators.set('orchestration-authoring', ajv.compile(authoringSchema))

for (const entry of await readdir(new URL('fixtures/', spec), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(json|yaml)$/.test(entry.name)) continue
  const match = /^(event|definition|context|binding|authoring-registration|orchestration-authoring)\.(valid|invalid)\.[^.]+\.(json|yaml)$/.exec(entry.name)
  if (match === null) throw new Error(`Schema fixture '${entry.name}' does not declare schema and expectation`)
  const fixtureText = await readFile(new URL(`fixtures/${entry.name}`, spec), 'utf8')
  const value = match[3] === 'yaml' ? parseYaml(fixtureText) : JSON.parse(fixtureText)
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

console.log('WorkSurface JSON Schemas and JSON/YAML fixtures are valid')
