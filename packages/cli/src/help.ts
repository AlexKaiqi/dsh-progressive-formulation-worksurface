export const VERSION = '0.1.0-rc.6'

export const HELP = `Usage: ws <command> [arguments] [options]

Commands:
  ws checkout <surface> <target> [--revision <revision>]
  ws commit <working-copy> --base <revision> --key <key> [--retry]
  ws show <surface> [--revision <revision>] [--projection --profile <name> [--token-budget <n>]]
  ws agent run --surface <surface> --task <text> --profile <name> --key <key> --result <path> [--from <template>] [--parent <surface>] [--retry]
  ws help init

Global options:
  --attempt <id>       Override WS_ATTEMPT_ID.
  --json               Emit one JSON value on stdout.
  --help               Show command help.
  --version            Show CLI version.

Effect commands require a stable idempotency key. Inside an Orchestrator,
the CLI reaches the Host through WS_HOST_SOCKET and never opens canonical state.
Agent retries reuse the Surface's bound continuable Session; local result files
are outputs for the calling script, not the recovery source of truth.
`

export const INIT_HELP = `PF WorkSurface initialization

Use a WorkSurface for complex, multi-stage work that benefits from durable
decisions, resumption, review, evidence, or independently delegated outputs.
Do not use it only to restate a simple answer or a bounded one-step file change.

Initialize the root before delegation:
  1. The Host has already checked out the session root named WS_WORKING_SURFACE
     at WS_WORKING_PATH (work/root relative to WS_ATTEMPT_DIR). WS_BASE_REVISION
     is its exact commit base; do not checkout a second root copy.
  2. Before run_orchestrator, write final UTF-8 files through b2f blocks such as
     file=work/root/surface.md or file=work/root/blocks/<block-id>.md. The script
     runs from the same workspace and sees those files immediately.
  3. Record the goal, acceptance criteria, known facts and constraints,
     assumptions, open questions, current decisions, and expected deliverables.
  4. Keep surface.md as the current state index. Put substantial evidence and
     deliverables in blocks/<block-id>.md and reference them from surface.md.
  5. Keep existing runtime-owned identity front matter unchanged. A new Block
     needs this minimum front matter, with values matching its path and Surface:

       ---
       block_id: <block-id>
       surface_id: <surface-id>
       kind: <task-relevant-kind>
       status: active
       ---

     Reference it as [[block:<surface-id>/<block-id>]].
  6. Mark superseded content explicitly; do not present assumptions as facts or
     preserve hidden reasoning.
  7. Commit WS_WORKING_PATH with WS_BASE_REVISION and a stable key.

Create a child Surface only for an independently owned deliverable with its own
goal, revision, completion evidence, and retry lifecycle. Parent Surfaces should
reference accepted child outputs instead of copying the child's work history.
`
