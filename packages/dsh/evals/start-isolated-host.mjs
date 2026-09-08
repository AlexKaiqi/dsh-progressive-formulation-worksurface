#!/usr/bin/env node
// Process controller for a previously materialized and verified scenario node.
// Credentials are parsed as data and passed only to the child, never recorded.
import { spawn, spawnSync } from 'node:child_process'
import { openSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs, parseEnv } from 'node:util'

const { values } = parseArgs({ options: {
  profile: { type: 'string' }, home: { type: 'string' }, port: { type: 'string' },
  dsh: { type: 'string' }, output: { type: 'string' }, 'credentials-file': { type: 'string' },
  'scenario-tool': { type: 'string' }, tree: { type: 'string' },
} })
if (!values.profile || !values.home || !values.port || !values.dsh || !values.output || !values['scenario-tool']) throw new Error('requires --profile --home --port --dsh --output --scenario-tool; optional --tree --credentials-file')
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port')
const lock = JSON.parse(await readFile(join(values.home, 'scenario.lock.json'), 'utf8'))
if (lock.scenario !== values.profile || !lock.dump?.ok || !lock.verifiedAt) throw new Error('scenario lacks independent verification')
const inspections = {}
for (const operation of ['show', 'diff']) {
  const checked = spawnSync(process.execPath, [values['scenario-tool'], operation, values.profile, ...(values.tree ? ['--tree', values.tree] : [])], { encoding: 'utf8' })
  if (checked.status !== 0) throw new Error(`scenario ${operation} failed: ${checked.stdout ?? ''}${checked.stderr ?? ''}`)
  inspections[operation] = checked.stdout
  process.stdout.write(checked.stdout)
}
if (!inspections.show.includes(`home:       ${values.home}\n`)) throw new Error('requested home differs from the scenario fact source')
const env = { ...process.env, DSH_HOME: values.home }
if (values['credentials-file']) {
  const parsed = parseEnv(await readFile(values['credentials-file'], 'utf8'))
  // Import only an optional API key. Actual model selection remains a host
  // decision and is recorded from request/header, never inferred from this file.
  if (parsed.OPENAI_API_KEY) env.OPENAI_API_KEY = parsed.OPENAI_API_KEY
}
const output = resolve(values.output)
await mkdir(output, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replaceAll(':', '-')
await writeFile(join(output, `scenario-${stamp}.json`), JSON.stringify({ verifiedLock: lock, inspections }, null, 2) + '\n')
const log = join(output, `host-${stamp}.log`)
const fd = openSync(log, 'ax', 0o600)
const child = spawn(values.dsh, ['--profile', values.profile, '--port', String(port), '--no-open'], {
  cwd: values.home, env, stdio: ['ignore', fd, fd],
})
const record = { profile: values.profile, home: values.home, pid: child.pid, controllerPid: process.pid, startedAt: new Date().toISOString(), executable: values.dsh, port, log }
await writeFile(join(output, `process-${stamp}.json`), JSON.stringify(record, null, 2) + '\n')
process.stdout.write(JSON.stringify(record) + '\n')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
const outcome = await new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
await writeFile(join(output, `exit-${stamp}.json`), JSON.stringify({ ...record, exitedAt: new Date().toISOString(), ...outcome }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ pid: child.pid, exited: true, ...outcome }) + '\n')
