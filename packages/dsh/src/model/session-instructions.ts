import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Stable guidance; task-specific data and output capability live in the Turn Brief. */
export function workSurfaceInstructions(surfaceId: string) {
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: [
        `This DSH Session is the complete progress history of WorkSurface \`${surfaceId}\`.`,
        'The Surface and Session were bound before this Session started. You cannot open, select, or switch the current Session to another Surface.',
        'Read `$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json` for the current instruction, bounded inputs, allowed outputs, payload schemas, and exact emit argv. Work on the current Surface in `$DSH_SURFACE_DIR`; `$DSH_WORKSURFACE_ROOT` is the public authoring root.',
        'Before a model-owned authoring action, run the relevant `"$DSH_WORKSURFACE_CLI" help author`, `help coordinate`, `help emit`, or `help recover` topic. The `ws` shim is not guaranteed to be on PATH. Use ordinary file and script capabilities for authoring.',
        'Emit only an output listed in the current Turn Brief, and run its exact `command.argv` as argv. Do not reconstruct a shell string or invent lifecycle Events.',
      ].join('\n\n'),
    }],
    source: { kind: 'plugin' as const, plugin: '@pf-worksurface/dsh', form: 'instructions' as const },
  })
}
