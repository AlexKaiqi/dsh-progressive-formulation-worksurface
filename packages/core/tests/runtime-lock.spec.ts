import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireRuntimeLock } from '../src/runtime-store-io.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const builtModule = new URL('../lib/types/runtime-store-io.js', import.meta.url).href
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'ws-lock-')); roots.push(root); return { root, lock: join(root, 'mutation.lock') } }
function child(script: string) {
  const processHandle = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  processHandle.stderr.on('data', chunk => { stderr += String(chunk) })
  const completed = once(processHandle, 'close').then(([code]) => { if (code !== 0) throw new Error(`lock worker failed (${code}): ${stderr}`) })
  return { processHandle, completed }
}

describe('process-owned Runtime lock', () => {
  it('keeps a live old owner and makes duplicate release harmless to its successor', async () => {
    const { lock } = await fixture()
    const release = await acquireRuntimeLock(lock)
    for (const file of await readdir(`${lock}.owners`)) await utimes(join(`${lock}.owners`, file), new Date(0), new Date(0))
    let acquired = false
    const successor = acquireRuntimeLock(lock).then(unlock => { acquired = true; return unlock })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(acquired).toBe(false)
    await release()
    const releaseSuccessor = await successor
    await release()
    expect((await readdir(`${lock}.owners`)).filter(file => file.endsWith('.ticket'))).toHaveLength(1)
    await releaseSuccessor()
  })

  it('serializes independent operating-system processes', async () => {
    const { root, lock } = await fixture()
    const counter = join(root, 'counter'); await writeFile(counter, '0')
    const script = `import { acquireRuntimeLock } from ${JSON.stringify(builtModule)};
      import { readFile, writeFile, open, unlink } from 'node:fs/promises';
      for (let index = 0; index < 12; index++) {
        const release = await acquireRuntimeLock(${JSON.stringify(lock)});
        try {
          const marker = await open(${JSON.stringify(join(root, 'critical'))}, 'wx'); await marker.close();
          const value = Number(await readFile(${JSON.stringify(counter)}, 'utf8'));
          await new Promise(resolve => setTimeout(resolve, 2));
          await writeFile(${JSON.stringify(counter)}, String(value + 1));
          await unlink(${JSON.stringify(join(root, 'critical'))});
        } finally { await release(); }
      }`
    await Promise.all(Array.from({ length: 4 }, () => child(script).completed))
    expect(await readFile(counter, 'utf8')).toBe('48')
  })

  it('recovers after a real owner process is killed', async () => {
    const { lock } = await fixture()
    const worker = child(`import { acquireRuntimeLock } from ${JSON.stringify(builtModule)}; await acquireRuntimeLock(${JSON.stringify(lock)}); process.stdout.write('acquired'); setInterval(() => {}, 1000);`)
    const killed = worker.completed.catch(() => undefined)
    try {
      await once(worker.processHandle.stdout, 'data')
      worker.processHandle.kill('SIGKILL')
      await killed
      const release = await acquireRuntimeLock(lock)
      await release()
      expect((await readdir(`${lock}.owners`)).filter(file => file.endsWith('.ticket'))).toHaveLength(0)
    } finally { worker.processHandle.kill('SIGKILL'); await killed }
  })
})
