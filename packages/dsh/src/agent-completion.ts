import { BlockId, SurfaceId, WorkSurfaceError } from '@pf-worksurface/core'
import type { BlockRef } from '@pf-worksurface/core'
import type { AgentCompletion } from './types.ts'
import { revisionValue, stringValue } from './params.ts'

export function parseAgentCompletion(value: unknown): AgentCompletion {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkSurfaceError('invalid-reference', 'child Agent did not return the structured completion object')
  }
  const record = value as Record<string, unknown>
  const surface = SurfaceId(stringValue(record.surface, 'surface'))
  const surfaceRevision = revisionValue(record.surfaceRevision, 'surfaceRevision')
  const summary = stringValue(record.summary, 'summary')
  if (Array.isArray(record.outputs) === false || record.outputs.length === 0) {
    throw new WorkSurfaceError('invalid-reference', 'child Agent outputs must be a non-empty array')
  }
  const outputs = record.outputs.map((item, index): BlockRef => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new WorkSurfaceError('invalid-reference', `child output ${index} must be an object`)
    }
    const output = item as Record<string, unknown>
    return {
      surface: SurfaceId(stringValue(output.surface, `outputs[${index}].surface`)),
      block: BlockId(stringValue(output.block, `outputs[${index}].block`)),
      revision: revisionValue(output.revision, `outputs[${index}].revision`),
    }
  })
  return { surface, surfaceRevision, summary, outputs }
}
