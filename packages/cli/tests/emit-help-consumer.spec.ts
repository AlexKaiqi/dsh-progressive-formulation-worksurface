import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { helpFor } from '../src/help.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('emit help executable consumer', () => {
  it.each(['portable', 'dsh'] as const)('executes the rendered %s example through the real CLI without shell interpolation', async host => {
    const root = await mkdtemp(join(tmpdir(), 'ws-emit-help-')); roots.push(root)
    const view = join(root, 'view with spaces'); await mkdir(join(view, 'contracts'), { recursive: true })
    const executable = join(root, 'cli with spaces.mjs')
    // The wrapper supplies Node, then runs the published CLI parser/transport.
    await writeFile(executable, `#!${process.execPath}\nimport { main } from ${JSON.stringify(new URL('../lib/bin.js', import.meta.url).href)};\nprocess.exitCode = await main();\n`, { mode: 0o700 })
    const names = host === 'dsh'
      ? { cli: 'DSH_WORKSURFACE_CLI', view: 'DSH_WORKSURFACE_VIEW_DIR' }
      : { cli: 'WORKSURFACE_CLI', view: 'WORKSURFACE_VIEW_DIR' }
    const socketPath = join(root, 'host.sock')
    await writeFile(join(view, '.runtime.json'), JSON.stringify({ version: 1, socketPath, capability: 'current-turn' }))
    await writeFile(join(view, 'contracts', 'review.completed.payload.schema.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'],
    }))
    await writeFile(join(view, 'turn-brief.json'), JSON.stringify({ outputs: [{
      name: 'review.completed', schemaPath: `$${names.view}/contracts/review.completed.payload.schema.json`,
      command: { argv: [`$${names.cli}`, 'emit', 'review.completed', '--payload', '<JSON matching schema>'] },
    }] }))
    const payload = { summary: 'Keep quotes " and apostrophes \' and $(touch unintended) literal.' }
    const payloadFile = join(root, 'payload with spaces.json'); await writeFile(payloadFile, JSON.stringify(payload))
    const env = { ...process.env, [names.cli]: executable, [names.view]: view }
    const help = helpFor('emit', env)
    expect(help).toContain('Direct argv execution does not expand environment variables automatically')
    const script = help.match(/python3 - "\$WS_OUTPUT" "\$WS_PAYLOAD" <<'PY'\n([\s\S]*?)\nPY/)?.[1]
    expect(script).toBeDefined()
    const calls: unknown[] = []
    const server = createServer(socket => {
      let buffer = ''
      socket.on('data', chunk => {
        buffer += chunk.toString()
        if (!buffer.includes('\n')) return
        const call = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        calls.push(call)
        socket.end(`${JSON.stringify({ id: call.id, result: { accepted: true } })}\n`)
      })
    })
    server.listen(socketPath); await once(server, 'listening')
    try {
      const child = spawn('python3', ['-', 'review.completed', payloadFile], { cwd: root, env })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk.toString() })
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      const completed = once(child, 'close')
      child.stdin.end(script)
      const [code] = await completed
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({ accepted: true })
      expect(calls).toEqual([{ id: expect.any(String), method: 'event.emit-turn', params: {
        capability: 'current-turn', name: 'review.completed', payload,
      } }])
      await expect(readFile(join(root, 'unintended'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
