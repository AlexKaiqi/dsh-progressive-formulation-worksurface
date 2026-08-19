/**
 * Generate `packages/dsh/spec/agent-return.schema.json` from the authoritative
 * `AGENT_OUTPUT_SCHEMA` export.
 *
 * The TypeScript export is the single source of the child-Agent return contract:
 * it is what `subagents.start()` actually enforces at runtime. This script
 * projects it into a standalone JSON Schema file so the contract is readable
 * without a TypeScript toolchain and can be compiled by an external validator.
 *
 * Run with `--check` to fail when the committed file is stale, which is what CI
 * uses to keep the two representations from drifting.
 *
 * Usage:
 *   node scripts/generate-agent-schema.mjs
 *   node scripts/generate-agent-schema.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const target = join(repoRoot, 'packages/dsh/spec/agent-return.schema.json')
const built = join(repoRoot, 'packages/dsh/lib/types/model/child-agent.js')

const { AGENT_OUTPUT_SCHEMA } = await import(`file://${built}`).catch((error) => {
  console.error(`error: cannot load ${built}`)
  console.error(`reason: ${error.message}`)
  console.error('next: run "npm run build" first, then re-run this script')
  process.exit(2)
})

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pf-worksurface.dev/agent-return.schema.json',
  title: 'PF WorkSurface child-Agent return contract',
  description:
    'Structured completion every child Agent must return. Generated from AGENT_OUTPUT_SCHEMA in packages/dsh/src/model/child-agent.ts; do not edit by hand.',
  ...AGENT_OUTPUT_SCHEMA,
}
const serialized = `${JSON.stringify(schema, null, 2)}\n`

if (process.argv.includes('--check')) {
  let current
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    console.error(`error: ${target} is missing`)
    console.error('next: run "npm run generate:schema"')
    process.exit(1)
  }
  if (current !== serialized) {
    console.error(`error: ${target} is stale`)
    console.error('reason: it no longer matches AGENT_OUTPUT_SCHEMA')
    console.error('next: run "npm run generate:schema" and commit the result')
    process.exit(1)
  }
  console.log('agent-return.schema.json is up to date')
} else {
  writeFileSync(target, serialized)
  console.log(`wrote ${target}`)
}
