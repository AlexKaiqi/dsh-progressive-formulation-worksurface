import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { AttemptAuthority } from './types.ts'

export function attemptDirectoryName(attemptId: string): string {
  return `attempt-${attemptDirectorySuffix()}-${attemptId.slice('attempt-'.length)}`
}

function attemptDirectorySuffix(date = new Date()): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`
}

export async function prepareAttempt(
  attempt: AttemptAuthority,
  language: 'bash' | 'python',
  script: string,
  codeHash: string,
  cliEntrypoint: string,
): Promise<void> {
  await mkdir(join(attempt.root, 'control'), { recursive: true, mode: 0o700 })
  await mkdir(join(attempt.root, 'runtime'), { recursive: true, mode: 0o700 })
  await mkdir(join(attempt.root, 'bin'), { recursive: true, mode: 0o700 })
  await mkdir(join(attempt.workspaceRoot, 'work'), { recursive: true, mode: 0o700 })
  await mkdir(join(attempt.workspaceRoot, 'results'), { recursive: true, mode: 0o700 })
  const scriptPath = join(attempt.root, 'control', language === 'bash' ? 'main.sh' : 'main.py')
  await writeFileAtomic(scriptPath, script, { mode: 0o700, dirMode: 0o700 })
  await writeFileAtomic(join(attempt.root, 'control', 'code-hash'), `${codeHash}\n`, { mode: 0o600, dirMode: 0o700 })
  await writeFileAtomic(join(attempt.root, 'control', 'workspace-hash'), `${attempt.workspaceHash}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
  await writeFileAtomic(join(attempt.root, 'control', 'attempt.json'), `${JSON.stringify({
    attemptId: attempt.id,
    rootSurface: attempt.rootSurface,
    workspaceSurface: attempt.workspaceSurface,
    rootBaseRevision: attempt.rootBaseRevision,
    codeHash,
    workspaceHash: attempt.workspaceHash,
  }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  const wrapper = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliEntrypoint)} "$@"\n`
  const wsPath = join(attempt.root, 'bin', 'ws')
  await writeFile(wsPath, wrapper, { mode: 0o700 })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
