import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const context = JSON.parse(await readFile(process.env.DSH_CONTEXT_FILE, 'utf8'))
const target = context.bindings.target
const result = spawnSync('ws', ['emit', 'handler.output', '--surface', target, '--key', 'handler-output', '--payload', JSON.stringify({ language: 'javascript', activation: context.activation.id })], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
