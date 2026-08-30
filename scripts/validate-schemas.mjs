import { readdir, readFile } from 'node:fs/promises'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const root = new URL('../', import.meta.url)
const spec = new URL('spec/', root)
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

const validators = new Map()
for (const name of ['event', 'definition', 'context', 'binding']) {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, spec), 'utf8'))
  if (!ajv.validateSchema(schema)) throw new Error(`${name}.schema.json is not a valid JSON Schema: ${ajv.errorsText()}`)
  validators.set(name, ajv.compile(schema))
}

for (const entry of await readdir(new URL('fixtures/', spec), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue
  const match = /^(event|definition|context|binding)\.(valid|invalid)\.[^.]+\.json$/.exec(entry.name)
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

console.log('WorkSurface JSON Schemas and fixtures are valid')
