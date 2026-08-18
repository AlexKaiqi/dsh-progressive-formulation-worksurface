import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readJsonOptional } from './json.ts'

export interface AttemptGcOptions {
  readonly attemptsRoot: string
  readonly attemptRetention: number
  readonly activeRoots: ReadonlySet<string>
  readonly runtimeRoot: string
}

export async function runAttemptGc(options: AttemptGcOptions): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(options.attemptsRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const candidates: Array<{ path: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (entry.isDirectory() === false || entry.name.startsWith('attempt-') === false) continue
    const path = resolve(options.attemptsRoot, entry.name)
    if (options.activeRoots.has(path)) continue
    try {
      const info = await stat(path)
      if (info.isDirectory()) candidates.push({ path, mtimeMs: info.mtimeMs })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const candidate of candidates.slice(options.attemptRetention)) {
    try {
      await archiveAttempt(options.runtimeRoot, candidate.path)
      await rm(candidate.path, { recursive: true, force: true })
    } catch {
      // Best-effort GC: a single corrupt legacy attempt must not break the Host.
    }
  }
}

async function archiveAttempt(runtimeRoot: string, attemptPath: string): Promise<void> {
  const result = await readJsonOptional<unknown>(join(attemptPath, 'runtime', 'result.json'))
  const control = await readControlFilesOptional(join(attemptPath, 'control'))
  if (result === undefined && control === undefined) return
  const archiveRoot = join(runtimeRoot, 'attempt-results')
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 })
  const archive = { ...(result === undefined ? {} : { result }), ...(control === undefined ? {} : { control }) }
  await writeFileAtomic(join(archiveRoot, `${basename(attemptPath)}.json`), `${JSON.stringify(archive, null, 2)}
`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

async function readControlFilesOptional(controlPath: string): Promise<Readonly<Record<string, string>> | undefined> {
  let entries: Dirent[]
  try {
    entries = await readdir(controlPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const files: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.isFile() === false || entry.isSymbolicLink()) continue
    files[entry.name] = await readFile(join(controlPath, entry.name), 'utf8')
  }
  return Object.keys(files).length === 0 ? undefined : files
}
