import type {
  OmittedWorkSurfaceProjectionFile,
  WorkSurfaceProjectionFile,
  WorkSurfaceProjectionSnapshot,
} from '@pf-worksurface/core'

export interface FileProjectionRenderOptions {
  /** Relative path from the active b2f root to the writable Surface checkout. */
  readonly writablePathPrefix?: string
}

/** Render one revision-pinned WorkSurface snapshot through the b2f file-fence carrier. */
export function renderFileProjection(
  projection: WorkSurfaceProjectionSnapshot,
  options: FileProjectionRenderOptions = {},
): string {
  const prefix = normalizePrefix(options.writablePathPrefix ?? '')
  const lines = [
    'PF WorkSurface Projection',
    `Surface: ${projection.surfaceId}`,
    `Revision: ${projection.surfaceRevision}`,
    `Profile: ${projection.profile}`,
    '',
    'Files:',
  ]

  for (const file of projection.files) {
    lines.push(`- ${manifestPath(file, prefix)}: ${file.revision}${file.writable ? '' : ' (read-only)'}`)
  }
  for (const file of projection.omittedFiles) {
    lines.push(`- ${manifestPath(file, prefix)}: ${file.revision} (omitted: token budget)`)
  }
  if (projection.budgetExceeded) {
    lines.push('', 'Budget notice: complete surface.md exceeds the requested Projection budget.')
  }

  for (const file of projection.files) {
    lines.push('', renderProjectedFile(file, prefix))
  }
  return lines.join('\n')
}

function renderProjectedFile(file: WorkSurfaceProjectionFile, prefix: string): string {
  const fence = safeFence(file.content)
  const content = file.content.endsWith('\n') ? file.content : `${file.content}\n`
  if (file.writable) {
    return `${fence}markdown file=${joinRelative(prefix, file.relativePath)}\n${content}${fence}`
  }
  return `Read-only file ${file.surfaceId}/${file.relativePath} at ${file.revision}:\n${fence}markdown\n${content}${fence}`
}

function manifestPath(
  file: WorkSurfaceProjectionFile | OmittedWorkSurfaceProjectionFile,
  prefix: string,
): string {
  return file.writable
    ? joinRelative(prefix, file.relativePath)
    : `${file.surfaceId}/${file.relativePath}`
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, '')
}

function joinRelative(prefix: string, relativePath: string): string {
  return prefix === '' ? relativePath : `${prefix}/${relativePath}`
}

function safeFence(content: string): string {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), match => match[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}
