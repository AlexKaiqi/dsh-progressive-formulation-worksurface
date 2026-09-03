import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('platform-neutral progression runtime', () => {
  it('has no host SDK dependency in its implementation modules', async () => {
    const files = ['engine.ts', 'code-first-orchestrator.ts', 'orchestrate-contract.ts']
    const sources = await Promise.all(files.map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')))
    expect(sources.join('\n')).not.toMatch(/@deepseek-ai|\bDSH\b|\bdsh[-_]/i)
  })
})
