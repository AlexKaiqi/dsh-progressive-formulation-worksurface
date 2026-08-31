import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Stable guidance; task-specific data and output capability live in the Turn Brief. */
export function workSurfaceInstructions(surfaceId: string) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `This DSH Session is the complete progress history of WorkSurface \`${surfaceId}\`.`,
        'The Surface and Session were bound before this Session started. You cannot open, select, or switch the current Session to another Surface.',
        'Read `$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json` for the current instruction, bounded inputs, allowed outputs, payload schemas, and exact `ws emit` argv. Work on the current Surface in `$DSH_SURFACE_DIR`; `$DSH_WORKSURFACE_ROOT` is the public authoring root.',
        'When the objective has independently assessable parts, plan first and split those parts into separate Surfaces. Do not create a generic parent-child graph: encode the exact relationship in ordinary Orchestrate code and a Registration.',
        'Use ordinary file and script capabilities to create complete Surface directories at `$DSH_WORKSURFACE_ROOT/surfaces/<surface-id>/`; do not call a Surface creation tool.',
        'Every new Surface requires surface.md with the seven headings: Goal; Acceptance Criteria; Known Facts and Constraints; Assumptions; Open Questions; Current Decisions; Deliverables and Evidence. Preserve its code, materials, fixtures, and evidence in the same directory.',
        'For multiple Surfaces, create `$DSH_WORKSURFACE_ROOT/orchestrations/<orchestration-id>/artifact/` containing ordinary entrypoint code, local Event Contract declarations, and support files. Keep `registration.json` beside `artifact/`, outside its immutable Revision; it binds stable local handles to existing Surfaces and declares `consumeFrom`, `emitOn`, and `surfaceOutputFrom` routes.',
        'Business conditions, transformation, fan-out, join, and loop belong in ordinary Orchestrate code. Do not create a Definition DSL, reaction list, effect protocol, or a second relationship graph.',
        'After all authoring directories are complete, emit only an output listed in the current Turn Brief. Runtime admits pending Registrations before append, validates the payload Contract, and deterministically owns namespace, cause, operation, retry, and recovery facts.',
        'Run the exact `command.argv` from the Turn Brief as argv, not by reconstructing a shell string.',
        '`ws emit` is the only model-side WorkSurface command. Construct and modify all content with ordinary file and script capabilities.',
        'Waiting, failure, cancellation, retry, and completion belong to the DSH Session/Turn and must not be emitted as WorkSurface lifecycle events. Emit only domain facts required by the authored Contracts.',
      ].join('\n\n'),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
