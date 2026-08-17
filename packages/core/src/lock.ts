import { open, readFile, rm } from 'node:fs/promises'

const RETRY_LIMIT_MS = 10_000

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

async function ownerIsAlive(path: string): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return false
    throw error
  }
  const pid = Number.parseInt(raw.trim(), 10)
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isErrorCode(error, 'ESRCH')
  }
}

/**
 * Serialize one cross-process mutation and reclaim locks whose owning process exited.
 * @param path - Exclusive lock-file path.
 * @param operation - Mutation to execute while holding the lock.
 * @returns The mutation result.
 */
export async function withRecoverableLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + RETRY_LIMIT_MS
  let delay = 10
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      break
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
    }
    if (!(await ownerIsAlive(path))) {
      await rm(path, { force: true })
      continue
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for live WorkSurface lock ${path}`)
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 200)
  }
  try {
    return await operation()
  } finally {
    await rm(path, { force: true })
  }
}
