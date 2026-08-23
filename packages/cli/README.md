# @pf-worksurface/cli

English | [中文](README.zh.md)

`@pf-worksurface/cli` provides the Git-style `ws` process boundary used by ordinary Bash and Python Orchestrators. Inside a DeepSeek Harness attempt it sends authenticated NDJSON requests to the private Host socket; outside an attempt, file commands can operate directly only when `WS_STORE_ROOT` is explicit.

## Commands

```text
ws checkout <surface> <target> [--revision <revision>]
ws commit <working-copy> --base <revision> --key <key> [--retry]
ws show <surface> [--revision <revision>] [--projection --profile <name>]
ws agent run --surface <surface> --task <text> --profile <name> --key <key> --result <path> [--from <template>] [--parent <surface>]
ws help init
```

Effect commands require stable keys. `--json` emits one JSON value on stdout, failures emit a stable error object on stderr, and `ws agent run` atomically writes its structured result file. Paths and document contents are passed as UTF-8 and support spaces and non-ASCII characters.

## Initialization guide

`ws help init` is the model-facing progressive-disclosure guide for authoring a useful first revision. It requires the editable checkout to stay inside `WS_ATTEMPT_DIR`, defines the minimum root state, keeps `surface.md` as the current index, gives the required front matter and reference syntax for new Blocks, distinguishes facts from assumptions and superseded content, and limits child Surfaces to independently owned deliverables. It is local static help: reading it requires no Host credentials and changes no WorkSurface state.

## Authority modes

When `WS_HOST_SOCKET`, `WS_ATTEMPT_ID`, and `WS_ATTEMPT_TOKEN` are present, the CLI uses `WorkSurfaceHostClient`; `DSH_WS_*` aliases support child-Agent shell environments. If an attempt-directory variable is present without a Host socket, the CLI fails closed instead of falling back to canonical files.

Direct mode requires `WS_STORE_ROOT` and supports operations on existing canonical state for administration and tests. Surface creation is delegation-bound, and `agent run` is Host-only because only the plugin can create the work unit and child Agent, then validate its structured completion.

## Exit status

Success is `0`; not found is `10`; revision conflict is `11`; invalid working copies and references are `12`; idempotency-key conflict is `13`; authorization failure is `14`; remaining stable failures are `15`.

## Model Experience

Indirectly, through ordinary Orchestrator and child-Agent shell calls whose results are rendered by `@pf-worksurface/dsh`. An Agent sees the initialization guide only after it runs `ws help init`.

#### KV Cache effect

No direct invalidation; the parent tool or child shell-tool result owns any appended model context.

## Known Limitations and Deferred Work

- **NDJSON over a local socket only** — the client implements one request per private Unix-domain connection and has no network transport.
- **No interactive conflict resolver** — a revision conflict is explicit and must be handled by the Orchestrator with another checkout or task-specific policy.
- **Direct mode is intentionally narrower** — it does not expose `agent run` and must never be enabled by an attempt environment.
