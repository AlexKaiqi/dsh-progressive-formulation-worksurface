/** System-prompt section order for the WorkSurface guidance block. */
export const WORKSURFACE_GUIDANCE_ORDER = 150

/** Parent-facing static guidance. It contains no dynamic Surface ids, revisions, or absolute paths. */
export function worksurfaceGuidance(): string {
  return 'PF WorkSurface is active. It externalizes verifiable task state, not hidden reasoning, for complex, multi-stage work. '
    + 'Use it proactively without waiting for the user to name it when work needs durable decisions, competing alternatives, delegation, later resumption, review, or evidence-backed delivery. '
    + 'Skip it for simple questions and bounded one-step changes whose existing files already contain the complete durable result. '
    + 'Before delegating, initialize the root with the goal, known facts, assumptions, constraints, acceptance criteria, open questions, current decisions, and expected deliverables. '
    + 'WorkSurface b2f paths under work/ are routed to a prepared root checkout at work/root; ordinary source paths stay in the Session workspace. Write surface.md or blocks/<block-id>.md under work/root with file blocks; successful writes are published to the canonical Surface before same-message tools run. '
    + 'Keep accepted state and supporting evidence current, and mark superseded content explicitly. Create child Surfaces only for independently owned deliverables. '
    + 'Call run_orchestrator with an ordinary Bash or Python script; it runs in that same workspace, where WS_WORKING_SURFACE, WS_WORKING_PATH, and WS_BASE_REVISION identify the prepared session checkout. '
    + 'For durable task logic, keep it in a committed control file under work/control/ and re-run it with the control parameter to replay the task against current state. '
    + 'In Code Mode call tools.run_orchestrator from run_code. '
    + 'Use ws --help for commands and ws help init for authoring guidance. '
    + 'Canonical files are Host-only, and child results count only when they name committed Block revisions.'
}
