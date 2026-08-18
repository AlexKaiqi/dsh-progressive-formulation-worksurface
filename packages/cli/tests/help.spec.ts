import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { HELP, INIT_HELP, VERSION } from '../src/help.ts'

describe('ws CLI model-facing help', () => {
  it('keeps the CLI version in sync with the package version', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })

  it('documents every command the model can invoke', () => {
    for (const command of [
      'ws new --from <template> --key <key> [--parent <surface>] [--surface <id>] [--retry]',
      'ws checkout <surface> <target>',
      'ws commit <working-copy> --base <revision> --key <key>',
      'ws show <surface> [--revision <revision>] [--projection --profile <name> [--token-budget <n>]]',
      'ws agent run --surface <surface> --task <text> --profile <name> --key <key> --result <path> [--retry]',
      'ws help init',
    ]) {
      expect(HELP).toContain(command)
    }
    expect(HELP).toContain('ws new --from <template> --key <key>')
    expect(HELP).toContain('--token-budget <n>')
    expect(HELP).toContain('ws agent run --surface <surface>')
    expect(HELP).toContain('Effect commands require a stable idempotency key')
    expect(HELP).toContain('Inside an Orchestrator')
    expect(HELP).toContain('never opens canonical state')
  })

  it('teaches the model how to initialize a WorkSurface before delegation', () => {
    expect(INIT_HELP).toContain('Use a WorkSurface for complex, multi-stage work')
    expect(INIT_HELP).toContain('Do not use it only to restate a simple answer')
    expect(INIT_HELP).toContain('session root named WS_WORKING_SURFACE')
    expect(INIT_HELP).toContain('WS_WORKING_PATH (work/root relative to WS_ATTEMPT_DIR)')
    expect(INIT_HELP).toContain('file=work/root/surface.md')
    expect(INIT_HELP).toContain('WS_BASE_REVISION')
    expect(INIT_HELP).toContain('Keep surface.md as the current state index')
    expect(INIT_HELP).toContain('blocks/<block-id>.md')
    expect(INIT_HELP).toContain('[[block:<surface-id>/<block-id>]]')
    expect(INIT_HELP).toContain('Commit WS_WORKING_PATH with WS_BASE_REVISION and a stable key')
    expect(INIT_HELP).toContain('Create a child Surface only for an independently owned deliverable')
  })
})
