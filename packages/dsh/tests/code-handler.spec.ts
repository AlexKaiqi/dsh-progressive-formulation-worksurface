import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RevisionStore } from '@pf-worksurface/core'
import { SubprocessCodeHandlerRunner } from '../src/code-handler.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ws-handler-v1-'))
  roots.push(root)
  const output = join(root, 'emits.jsonl')
  const runner = new SubprocessCodeHandlerRunner({} as never, root, new RevisionStore(join(root, 'revisions')))
  const readEmits = (runner as unknown as {
    readEmits(path: string, bindings: Readonly<Record<string, string>>, allowed: readonly string[]): Promise<readonly unknown[]>
  }).readEmits.bind(runner)
  return { output, readEmits }
}

describe('handler Event API boundary', () => {
  it('accepts a stable operation key only for a declared target role', async () => {
    const { output, readEmits } = await fixture()
    await writeFile(output, `${JSON.stringify({ surface: 'target-surface', name: 'review.recorded', payload: { ok: true }, operationKey: 'record-review' })}\n`)
    await expect(readEmits(output, { target: 'target-surface' }, ['target'])).resolves.toEqual([{
      targetRole: 'target', name: 'review.recorded', payload: { ok: true }, operationKey: 'record-review',
    }])
  })

  it('rejects undeclared targets and missing operation keys', async () => {
    const { output, readEmits } = await fixture()
    await writeFile(output, `${JSON.stringify({ surface: 'other-surface', name: 'review.recorded', payload: null, operationKey: 'record-review' })}\n`)
    await expect(readEmits(output, { target: 'target-surface' }, ['target'])).rejects.toMatchObject({ code: 'unauthorized' })
    await writeFile(output, `${JSON.stringify({ surface: 'target-surface', name: 'review.recorded', payload: null })}\n`)
    await expect(readEmits(output, { target: 'target-surface' }, ['target'])).rejects.toMatchObject({ code: 'effect-failed' })
  })
})
// Invariant assertion: [WS-19]
