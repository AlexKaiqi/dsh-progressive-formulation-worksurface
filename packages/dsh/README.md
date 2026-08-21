# @pf-worksurface/dsh

English | [中文](README.zh.md)

`@pf-worksurface/dsh` mounts WorkSurface as a DeepSeek Harness `Service`. `@deepseek-ai/dsh-block-to-file` materializes model file blocks into a least-authority workspace, while WorkSurface keeps canonical files behind an authenticated Host, provides one ordinary-script orchestration tool, and delegates revision-pinned Projections to child Agents.

## Installation

The `0.1.0-rc.5` package family targets DeepSeek Harness `0.1.0-rc.6`. The `/dsh` bundle composes `@deepseek-ai/dsh-block-to-file` before WorkSurface and depends on the matching `/core` and `/cli` packages, so a consumer installs one product. Its default rows store state under the Harness home and use the base profile's in-process `spawn` Subagent provider.

Install the plugin into the standard Web profile. The Harness plugin command recognizes its bundle metadata and appends it after the profile's existing bundles:

```sh
dsh plugin --profile web add '@pf-worksurface/dsh@0.1.0-rc.5'
dsh plugin --profile web add '@pf-worksurface/web@0.1.0-rc.5'
dsh --profile web --dump-config
dsh plugin --profile web exec ws --version
```

The second line is the optional Web visualization companion and should be installed after `/dsh`. The same `add` command works with another profile name and preserves its existing bundle order. A profile-level `cordis.patch.yml` can override the inserted `pf-worksurface` row; because a patch replaces the whole `config`, an override restates every field it retains.

After an install or upgrade, restart every DSH process that already loaded the profile, then start a fresh Agent task to verify the assembled request. An existing process continues running the package code it loaded at startup.

## Runtime contract

Before each parent model step, the service creates the session's durable root Surface and a pending attempt. Its public `workspace/` is registered as that Agent's b2f root and contains a revision-pinned root checkout at `work/root`; private `control/`, `runtime/`, and `bin/` remain outside the b2f and sandbox boundary. `run_orchestrator` claims the pending attempt, executes unchanged Bash or Python source from the same public workspace, and exposes a generated `ws` wrapper plus attempt-scoped credentials. An omitted or blank `rootSurface` selects the session root. Canonical storage is outside every model-writable root.

Plugin activation waits until the canonical store, session template, and authenticated Host socket are ready. Invalid persistent roots, socket placement, profiles, and numeric limits reject activation instead of leaving a partially mounted tool surface.

The Host authorizes each NDJSON request. An Orchestrator may access only Surfaces created or admitted by its attempt. A child credential is narrower: it may inspect its assigned Surface and commit only its exact assigned checkout. The service also guards other model tools from receiving the canonical root path.

`ws agent run` compiles a revision-pinned Projection, materializes a fresh checkout, starts an in-process Subagent provider, and requires the child to return `{ surface, surfaceRevision, summary, outputs }`. Completion is accepted only after the assigned Surface has a new commit and every output names an existing Block at that exact current revision. Final prose is never treated as a result fallback.

Every flat Surface owns an append-only Work Session from creation. The parent Work Session records direct child creation and child execution boundaries, and the child Work Session records its own revisions and Agent attachment; recursively folding these local histories produces the WorkGraph. The top-level Agent Session attaches to the root Surface and a delegated Agent Session attaches to its child Surface. Either identity can be attached only once. The exact Projection revisions consumed by the child remain in canonical Work Session events so the information-dependency graph is auditable. Orchestrator programs are stored once under `canonical/orchestrator/definitions/<sha256>`; run lifecycle facts stay in the calling Surface Session while attempt workspaces remain runtime state. A Web profile can install `@pf-worksurface/web` to render that graph and each node's attached conversation.

Every external effect is journaled by attempt and key. Attempt identity includes both the immutable control-script hash and a deterministic hash of the public workspace, so the same script with different b2f inputs cannot replay the wrong effects. A crash after immutable commit persistence is reconciled by completing its idempotent Work Session publication, signal-terminated Orchestrators may be replayed up to `maxCrashReplays`, and the service waits for in-flight child operations to become quiescent before releasing attempt authority.

## Configuration

`root` is required and must be a persistent path outside operating-system temporary roots. `profiles` is a non-empty list; each profile specifies `name`, Subagent `provider`, Projection `tokenBudget`, `maxDepth`, `maxParallel`, and optional `toolAllow`, `persona`, `agentProvider`, and `agentModel`.

`attemptsRoot` defaults to `root/runtime/orchestrator/runs`. `socketPath` defaults to `root/run/host.sock`, keeping the socket in the same data root as canonical, journal, and attempts; it only falls back to a hash-named socket under `~/.pf-worksurface/run` when `root` is too long for the portable Unix socket-path limit. `cliEntrypoint` resolves from the installed CLI package. `orchestratorGraceMs` defaults to 5000, `maxOutputBytes` to 1 MiB, `maxCrashReplays` to 1, and `attemptRetention` to 10. Attempt directory names include creation time for human orientation. Each contains a private control/runtime area and a model-writable `workspace/`; pending workspaces remain protected from GC until claimed. Attempts beyond the retention window have `runtime/result.json` and `control/` archived into `runtime/orchestrator/attempt-results/` before removal. An explicit socket must remain outside `attemptsRoot` and fit the portable Unix path limit.

The package default export is `WorkSurfaceService`; the mounted service is available as `ctx.workSurfaces`. Observe-only lifecycle events are `worksurface/attempt-start`, `worksurface/attempt-end`, `worksurface/agent-start`, and `worksurface/agent-end`.

## Model Experience

Model-visible prompts, tool descriptions, CLI help, and structured contracts live in `src/model/` (CLI help in `packages/cli/src/help.ts`) and are pinned by `packages/dsh/tests/model-awareness.spec.ts` and `packages/cli/tests/help.spec.ts`. See `src/model/README.md` for the spec.

### Parent orchestration tool

#### What the model sees

The parent receives b2f file-block instructions, static PF WorkSurface guidance, one `run_orchestrator` tool, and the current session root Projection. The Projection carries the complete `surface.md` and same-Surface Blocks through b2f-compatible file fences; pinned cross-Surface Blocks are rendered read-only. Before the tool call it can write `work/root/surface.md`, Blocks, templates, and other public inputs through b2f; the script then runs in that exact workspace with `WS_WORKING_SURFACE`, `WS_WORKING_PATH`, and `WS_BASE_REVISION`. The tool result includes the root Surface, attempt identity, script hash, workspace hash, bounded process outcome, replay count, and final root revision.

#### Token effect

The fixed instructions and tool definition are present while the plugin is mounted. The current Projection consumes data-dependent tokens up to the default profile's approximate budget, and each call appends one rendered JSON result whose size is bounded by `maxOutputBytes` per output stream.

#### KV Cache effect

The static instructions omit Surface ids, revisions, paths, and run identities so they and the tool definition remain in the reusable request prefix across sessions. The current Projection and each result follow that prefix because file state may change between requests.

### Child WorkSurface persona

#### What the model sees

Each fresh child sees its optional profile persona, assigned Surface id, compiled `Projection`, exact base revision, the required `ws commit` procedure, and the structured completion contract. Its exact checkout is also its b2f root, so file blocks may write only `surface.md` and `blocks/<block-id>.md`.

#### Token effect

The complete `surface.md` and directly referenced Block files consume data-dependent tokens up to the profile's approximate Projection budget; Blocks that do not fit are omitted as whole files. Fixed commit and return instructions consume additional tokens.

#### KV Cache effect

The persona is per-run because Surface content, revision, and working path change; it does not create a stable cross-run prefix.

## Real-model evaluation

Static tests prove that guidance and tool contracts are present; they do not prove that a model can use them. Real-model cases for proactive adoption, correct skipping, root commits, Block/Surface granularity, delegation, conflict recovery, traceable delivery, and repeatability live under [`evals/`](evals/README.md).

```sh
npm run eval:check
```

## Known Limitations and Deferred Work

- **In-process child providers only** — least-authority shell environment binding depends on a local child Agent identity; remote Subagent providers are rejected.
- **macOS sandbox proof is platform-specific** — the shipped integration gate exercises the real Seatbelt profile on macOS; equivalent Landlock and Windows ACL integration coverage remains deferred.
- **No distributed Host** — the authenticated transport is a private local socket and canonical publication assumes one shared filesystem.
- **Observer containment is not yet isolated** — lifecycle listeners use ordinary Cordis event delivery and should remain non-throwing.
