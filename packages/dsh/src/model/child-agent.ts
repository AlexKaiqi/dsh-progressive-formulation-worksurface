import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Revision, SurfaceIdType } from '@pf-worksurface/core'
import type { WorkSurfaceProfile } from '../types.ts'

/** Structured completion contract enforced for every child Agent. */
export const AGENT_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    surface: { type: 'string' },
    surfaceRevision: { type: 'string' },
    summary: { type: 'string' },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface: { type: 'string' },
          block: { type: 'string' },
          revision: { type: 'string' },
        },
        required: ['surface', 'block', 'revision'],
      },
    },
  },
  required: ['surface', 'surfaceRevision', 'summary', 'outputs'],
}

/** Child-Agent persona combining the profile persona with the WorkSurface contract. */
export function childPersona(
  profile: WorkSurfaceProfile,
  surface: SurfaceIdType,
  projection: string,
  baseRevision: Revision,
  workingPath: string,
): string {
  return `${profile.persona === undefined ? '' : `${profile.persona}\n\n`}Assigned WorkSurface: ${surface}\n\nCurrent WorkSurface Projection:\n\n${projection}\n\n`
    + `Your only editable WorkSurface checkout and b2f root is ${workingPath}. Its required commit base revision is ${baseRevision}. `
    + 'Write only surface.md and blocks/<block-id>.md with file blocks; do not create other top-level entries. '
    + 'Use the ws CLI to commit it with that exact --base revision and a stable --key. '
    + 'Return only the required structured completion: surface, surfaceRevision, summary, and non-empty outputs. '
    + 'Every output must name a committed Block in your assigned Surface at its exact revision.'
}

