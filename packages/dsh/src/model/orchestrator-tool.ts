import type { OrchestratorResult } from '../types.ts'

/** Model-visible surface of the run_orchestrator tool. */
export const ORCHESTRATOR_TOOL_SURFACE = {
  name: 'run_orchestrator',
  description: 'Run an ordinary Bash or Python control script in the b2f-populated PF WorkSurface workspace. Use it for complex, multi-stage work that needs durable decisions, resumption, review, evidence, or independently delegated deliverables; skip simple questions and bounded one-step changes.',
  parameters: {
    language: { type: 'string', required: true, enum: ['bash', 'python'], description: 'Ordinary script language.' },
    script: { type: 'string', description: 'Inline control script; runs when control is omitted. It runs from the same workspace b2f populated, ws is on PATH, WS_ROOT_SURFACE names the authorized root, WS_WORKING_SURFACE, WS_WORKING_PATH, and WS_BASE_REVISION identify the prepared session checkout, and ws help init supplies authoring guidance.' },
    control: { type: 'string', description: 'Control source reference: a relative path of a committed control script in the attempt workspace (for example work/control/plan.sh), or the stored definition revision sha256:<codeHash> reported by a previous result to replay it. The source is stored once by content and executed; re-running the same control re-executes the task logic against current workspace state. Provide exactly one of script or control.' },
    rootSurface: { type: 'string', description: 'Authorized root Surface; omit it or pass an empty value to use the calling Agent session root.' },
  },
} as const

export const ORCHESTRATOR_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attemptId: { type: 'string', required: true },
      rootSurface: { type: 'string', required: true },
      codeHash: { type: 'string', required: true },
      workspaceHash: { type: 'string', required: true },
      exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      stdout: { type: 'string', required: true },
      stderr: { type: 'string', required: true },
      replayCount: { type: 'integer', required: true },
      rootRevision: { type: 'string', required: true },
    },
  } as const,
  render: (_args: unknown, value: OrchestratorResult) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}
