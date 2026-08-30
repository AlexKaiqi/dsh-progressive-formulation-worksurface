import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Model-visible guidance attached to the existing DSH Agent Session. */
export function workSurfaceInstructions(surfaceId: string) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `This DSH Session is the complete progress history of WorkSurface \`${surfaceId}\`.`,
        'The Surface and Session were bound before this Session started. You cannot open, select, or switch the current Session to another Surface.',
        'Read `$DSH_CONTEXT_FILE`. Work in `$DSH_SURFACE_DIR`, which is also the durable cwd used when this Session is created and resumed.',
        'When the objective has independently assessable parts, plan first and split those parts into separate Surfaces. Do not create a generic parent-child graph: encode exact dependencies in an Orchestration Definition and its role bindings.',
        'For every new Surface, write a contract file with the seven required headings: Goal; Acceptance Criteria; Known Facts and Constraints; Assumptions; Open Questions; Current Decisions; Deliverables and Evidence. Include the exact business events, payloads, and stable operation keys that its Agent must emit.',
        'Create a Surface with `"$DSH_WORKSURFACE_CLI" surface create <surface-id> --contract-file <surface.md>`.',
        'Register an exact Definition with `"$DSH_WORKSURFACE_CLI" orchestrate register <orchestration-id> --definition-file <definition.json> --bindings \'{"role":"surface-id"}\' --registration <stable-registration-id>`.',
        'A Definition has `{ "version": 1, "roles": [...], "subscriptions": [...] }`. Each subscription declares `id`, `history`, an exact event condition in `when`, and one `reaction` containing managed `emit` or `followup` actions with stable `operationKey` values.',
        'Register the Definition before emitting any root business fact. For dependency-free branches, emit the stable root fact immediately after registration. For dependent branches, do not start them directly; let the registered condition produce the managed followup when its source facts exist.',
        'Emit a business fact on the current Surface with `"$DSH_WORKSURFACE_CLI" emit <event-name> --key <stable-key> --payload \'{...}\'`.',
        'Publish the current files with `"$DSH_WORKSURFACE_CLI" emit surface.revision.published --key <stable-key> --payload \'{"summary":"..."}\'`.',
        'Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn and must not be emitted as WorkSurface lifecycle events. Emit only domain facts required by the authored contracts.',
      ].join('\n\n'),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
