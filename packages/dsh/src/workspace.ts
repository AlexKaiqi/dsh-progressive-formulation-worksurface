import { createHash, randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { sha256, WorkSurfaceError, type Revision, type SurfaceIdType, type WorkSurfaceStore } from '@pf-worksurface/core'
import { attemptDirectoryName } from './attempt.ts'
import type { PendingWorkspace } from './types.ts'

/** Create the public workspace that b2f will populate before an Orchestrator tool call. */
export async function preparePendingWorkspace(
  store: WorkSurfaceStore,
  attemptsRoot: string,
  agent: Agent,
  rootSurface: SurfaceIdType,
  rootBaseRevision: Revision,
): Promise<PendingWorkspace> {
  const nonce = randomBytes(12).toString('hex')
  const draftId = `attempt-${sha256(`${agent.id}\0${Date.now()}\0${nonce}`).slice(0, 24)}`
  const root = join(attemptsRoot, attemptDirectoryName(draftId))
  const workspaceRoot = join(root, 'workspace')
  const rootWorkingPath = join(workspaceRoot, 'work', 'root')
  try {
    await mkdir(join(workspaceRoot, 'work'), { recursive: true, mode: 0o700 })
    await mkdir(join(workspaceRoot, 'results'), { recursive: true, mode: 0o700 })
    await store.checkout({ surface: rootSurface, revision: rootBaseRevision, targetPath: rootWorkingPath })
    return {
      ownerId: String(agent.id),
      root,
      workspaceRoot,
      rootSurface,
      rootWorkingPath,
      rootBaseRevision,
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

/** Hash a complete public workspace independently of directory enumeration order. */
export async function hashWorkspace(root: string): Promise<string> {
  const hash = createHash('sha256')
  await hashDirectory(hash, root, '')
  return `sha256:${hash.digest('hex')}`
}

async function hashDirectory(hash: ReturnType<typeof createHash>, root: string, relativeRoot: string): Promise<void> {
  const directory = relativeRoot === '' ? root : join(root, relativeRoot)
  const entries = (await readdir(directory, { withFileTypes: true })).sort(compareDirent)
  for (const entry of entries) {
    const relativePath = relativeRoot === '' ? entry.name : `${relativeRoot}/${entry.name}`
    if (entry.isSymbolicLink()) {
      throw new WorkSurfaceError('unauthorized', `workspace symlink '${relativePath}' is forbidden`)
    }
    if (entry.isDirectory()) {
      hash.update('directory\0')
      hash.update(relativePath)
      hash.update('\0')
      await hashDirectory(hash, root, relativePath)
      continue
    }
    if (!entry.isFile()) {
      throw new WorkSurfaceError('invalid-working-copy', `unsupported workspace entry '${relativePath}'`)
    }
    const bytes = await readFile(join(root, relativePath))
    hash.update('file\0')
    hash.update(relativePath)
    hash.update('\0')
    hash.update(String(bytes.byteLength))
    hash.update('\0')
    hash.update(bytes)
    hash.update('\0')
  }
}

function compareDirent(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}
