import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Model-visible guidance attached to the existing DSH Agent Session. */
export function workSurfaceInstructions(surfaceId: string) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `This DSH Session is the complete progress history of WorkSurface \`${surfaceId}\`.`,
        'The Surface and Session were bound before this Session started. You cannot open, select, or switch the current Session to another Surface.',
        'Read `$DSH_CONTEXT_FILE`. The Session workspace is `$DSH_WORKSURFACE_ROOT`; work on the current Surface in `$DSH_SURFACE_DIR`.',
        'When the objective has independently assessable parts, plan first and split those parts into separate Surfaces. Do not create a generic parent-child graph: encode exact dependencies in an Orchestration Definition and its role bindings.',
        'Use ordinary file and script capabilities to create each complete Surface directory at `$DSH_WORKSURFACE_ROOT/surfaces/<surface-id>/`; do not call a Surface creation tool.',
        'Every new Surface requires surface.md with the seven headings: Goal; Acceptance Criteria; Known Facts and Constraints; Assumptions; Open Questions; Current Decisions; Deliverables and Evidence. Preserve its code, materials, fixtures, and evidence in the same directory.',
        'For multiple Surfaces, create `$DSH_WORKSURFACE_ROOT/orchestrations/<orchestration-id>/definition.json` and `registration.json` with any handlers and supporting files. registration.json is `{ "version": 1, "registrationId": "<stable-id>", "bindings": { "role": "surface-id" } }`; it is admission metadata and is not part of the Definition Revision.',
        'A Definition has `{ "version": 1, "roles": [...], "subscriptions": [...] }`. Each subscription declares `id`, `history`, an exact event condition in `when`, and one `reaction` containing managed `emit` or `followup` actions with stable `operationKey` values.',
        'After all directories are complete, emit one stable root business fact. Runtime fixes every pending registration before appending that fact: subscriptions directly matching the root fact start dependency-free Surfaces, while dependent Surfaces wait for their exact conditions.',
        'Emit a business fact on the current Surface with `"$DSH_WORKSURFACE_CLI" emit <event-name> --key <stable-key> --payload \'{...}\'`.',
        'Publish the current files with `"$DSH_WORKSURFACE_CLI" emit surface.revision.published --key <stable-key> --payload \'{"summary":"..."}\'`.',
        '`ws emit` is the only model-side WorkSurface command. Construct and modify all content with ordinary file and script capabilities.',
        'Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn and must not be emitted as WorkSurface lifecycle events. Emit only domain facts required by the authored contracts.',
      ].join('\n\n'),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
