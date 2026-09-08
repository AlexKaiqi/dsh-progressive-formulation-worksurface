#!/usr/bin/env node
// Drives an already verified, isolated DSH profile through its shipped Web API.
// No model responses, tools, or business files are synthesized by this runner.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  phase: { type: 'string' }, url: { type: 'string' }, profile: { type: 'string' },
  home: { type: 'string' }, output: { type: 'string' }, session: { type: 'string' },
  provider: { type: 'string' }, model: { type: 'string' },
  'wait-ms': { type: 'string', default: '180000' },
} })
const phase = values.phase
if (!['env', 'm1', 'm2', 'm3', 'resume'].includes(phase) || !values.url || !values.profile || !values.home || !values.output) {
  throw new Error('usage: live-agent-acceptance.mjs --phase env|m1|m2|m3|resume --url http://127.0.0.1:PORT --profile ID --home PATH --output PATH [--session ID] [--wait-ms N]')
}
const base = new URL(values.url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('acceptance runner only addresses a local isolated host')
const timeout = Number(values['wait-ms'])
if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('invalid wait duration')
if ((values.provider === undefined) !== (values.model === undefined)) throw new Error('--provider and --model must be supplied together')
const cases = JSON.parse(await readFile(new URL('./agent-acceptance-prompts.json', import.meta.url), 'utf8')).cases
const spec = cases[phase === 'resume' ? 'm3' : phase]
const sessionId = values.session ?? `ws-acceptance-${phase}-${randomUUID()}`
if (phase === 'resume' && !values.session) throw new Error('resume requires the existing Session identity')
const output = resolve(values.output, `${phase}-${sessionId}`)
await mkdir(output, { recursive: true, mode: 0o700 })
const prompt = phase === 'resume' ? spec.resumePrompt : spec.prompt
await writeFile(join(output, 'input.json'), JSON.stringify({ gate: spec.gate, phase, sessionId, profile: values.profile, home: values.home, prompt, requiredEvidence: spec.requires, ...(values.provider ? { modelDecision: { provider: values.provider, model: values.model, source: 'public session.selectModel API; also changes this isolated Host default' } } : {}) }, null, 2) + '\n')
let cookie
const hello = await fetch(base)
const cookies = hello.headers.getSetCookie?.() ?? []
if (cookies.length) cookie = cookies.map(item => item.split(';')[0]).join('; ')
await hello.body?.cancel()
let rpcIndex = 0
async function rpc(method, payload, record = true) {
  const rpcId = randomUUID()
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base.origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`)
  const body = await response.json()
  if (record) await writeFile(join(output, `rpc-${++rpcIndex}-${method}.json`), JSON.stringify(body, null, 2) + '\n')
  if (!body.result?.ok) throw new Error(`${method}: ${JSON.stringify(body.result?.error ?? body).slice(0, 1000)}`)
  return body.result.value
}
if (phase !== 'resume') await rpc('session.create', { sessionId, agentPreset: values.profile, cwd: join(values.home, 'scenario-data', values.profile, 'acceptance', phase) })
if (values.provider) await rpc('session.selectModel', { sessionId, provider: values.provider, model: values.model })
const before = await rpc('session.history', { sessionId, maxMessages: 10000 })
const eventsOf = history => (history.events ?? []).map(entry => entry.event ?? entry)
const beforeSeq = Math.max(-1, ...eventsOf(before).map(event => event.seq))
await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: 'Asia/Shanghai' })
process.stdout.write(JSON.stringify({ status: 'running', gate: spec.gate, sessionId, evidence: output }) + '\n')
const started = Date.now()
let history = before
let complete = false
while (Date.now() - started < timeout) {
  await new Promise(resolve => setTimeout(resolve, 2000))
  history = await rpc('session.history', { sessionId, maxMessages: 10000 }, false)
  const newer = eventsOf(history).filter(event => event.seq > beforeSeq)
  if (newer.some(event => event.type === 'turn/end')) { complete = true; break }
}
await writeFile(join(output, 'history.json'), JSON.stringify(history, null, 2) + '\n')
const events = eventsOf(history).filter(event => event.seq > beforeSeq)
const calls = events.filter(event => event.type === 'tool/call')
const messages = events.filter(event => event.type === 'assistant/message')
const summary = {
  gate: spec.gate, phase, sessionId, execution: complete ? 'turn-ended' : 'still-running',
  acceptance: 'requires-evidence-review', toolCalls: calls.length, assistantMessages: messages.length,
  requiredEvidence: spec.requires, elapsedMs: Date.now() - started,
}
// Negative checks are mechanical; semantic correctness and real recovery must
// be judged from original evidence, never from the model's completion claim.
if (phase === 'm1' && calls.length > 0) summary.acceptance = 'failed-tools-before-direct-answer'
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify(summary) + '\n')
