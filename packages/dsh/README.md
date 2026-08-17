# @pf-worksurface/dsh

English | [中文](README.zh.md)

`@pf-worksurface/dsh` mounts WorkSurface as a DeepSeek Harness `Service`. It keeps canonical files behind an authenticated Host, gives the parent model one ordinary-script orchestration tool, and delegates file Projections to child Agents through the public Sandbox, Subprocess, Subagent, Tool, and ShellEnv seams.

## Installation

The `0.1.0-rc.5` package family targets DeepSeek Harness `0.1.0-rc.6`. The `/dsh` package depends on the matching `/core` and `/cli` packages, so a consumer installs one package. The published package is also a DSH composition bundle whose default row stores state under the Harness home and uses the base profile's in-process `spawn` Subagent provider.

Install the plugin into the standard Web profile. The Harness plugin command recognizes its bundle metadata and appends it after the profile's existing bundles:

```sh
dsh plugin --profile web add '@pf-worksurface/dsh@0.1.0-rc.5'
dsh --profile web --dump-config
dsh plugin --profile web exec ws --version
```

The same `add` command works with another profile name and preserves its existing bundle order. A profile-level `cordis.patch.yml` can override the inserted `pf-worksurface` row; because a patch replaces the whole `config`, an override restates every field it retains.

After an install or upgrade, restart every DSH process that already loaded the profile, then start a fresh Agent task to verify the assembled request. An existing process continues running the package code it loaded at startup.

## Runtime contract

The service creates one deterministic durable root Surface for each Agent session before assembling that Agent's first model request. A fresh root starts with headings for its goal, acceptance criteria, known facts and constraints, assumptions, open questions, current decisions, and deliverables with evidence. The parent invokes `run_orchestrator` with Bash or Python source; an omitted or blank `rootSurface` selects that session root. The service creates a private attempt directory, writes the unchanged script, confines it with the Harness `workspace-write` policy, and exposes only a generated `ws` wrapper plus attempt-scoped credentials. Canonical storage is outside the sandbox and is never placed in the child environment.

Plugin activation waits until the canonical store, session template, and authenticated Host socket are ready. Invalid persistent roots, socket placement, profiles, and numeric limits reject activation instead of leaving a partially mounted tool surface.

The Host authorizes each NDJSON request. An Orchestrator may access only Surfaces created or admitted by its attempt. A child credential is narrower: it may inspect its assigned Surface and commit only its exact assigned checkout. The service also guards other model tools from receiving the canonical root path.

`ws agent run` compiles a revision-pinned Projection, materializes a fresh checkout, starts an in-process Subagent provider, and requires the child to return `{ surface, surfaceRevision, summary, outputs }`. Completion is accepted only after the assigned Surface has a new commit and every output names an existing Block at that exact current revision. Final prose is never treated as a result fallback.

Every external effect is journaled by attempt and key. A crash after `HEAD` publication is reconciled from the commit record, signal-terminated Orchestrators may be replayed up to `maxCrashReplays`, and the service waits for in-flight child operations to become quiescent before releasing attempt authority.

## Configuration

`root` is required and must be a persistent path outside operating-system temporary roots. `profiles` is a non-empty list; each profile specifies `name`, Subagent `provider`, Projection `tokenBudget`, `maxDepth`, `maxParallel`, and optional `toolAllow`, `persona`, `agentProvider`, and `agentModel`.

`attemptsRoot` defaults beneath `root`. `socketPath` defaults to a root-hash-named socket in the private `~/.pf-worksurface/run` directory, avoiding Unix socket-length failures when `root` is long; `cliEntrypoint` resolves from the installed CLI package. `orchestratorGraceMs` defaults to 5000, `maxOutputBytes` to 1 MiB, and `maxCrashReplays` to 1. An explicit socket must remain outside `attemptsRoot` and fit the portable Unix path limit.

The package default export is `WorkSurfaceService`; the mounted service is available as `ctx.workSurfaces`. Observe-only lifecycle events are `worksurface/attempt-start`, `worksurface/attempt-end`, `worksurface/agent-start`, and `worksurface/agent-end`.

## Model Experience

### Parent orchestration tool

#### What the model sees

The parent receives static PF WorkSurface instructions, one `run_orchestrator` tool with required `language` and `script` arguments plus optional `rootSurface`, and the current session root Projection as durable runtime context. The instructions define positive and negative activation criteria, distinguish verifiable task state from hidden reasoning, require a minimum first-use state before delegation, and reserve child Surfaces for independently owned deliverables. They direct the model to `ws --help` for command discovery and `ws help init` for file-authoring guidance. The Projection identifies its Surface and revision and contains the current file state. The tool result is JSON containing the root Surface, attempt identity, script hash, exit status, bounded stdout/stderr, replay count, and final root revision.

#### Token effect

The fixed instructions and tool definition are present while the plugin is mounted. The current Projection consumes data-dependent tokens up to the default profile's approximate budget, and each call appends one rendered JSON result whose size is bounded by `maxOutputBytes` per output stream.

#### KV Cache effect

The static instructions omit Surface ids, revisions, paths, and run identities so they and the tool definition remain in the reusable request prefix across sessions. The current Projection and each result follow that prefix because file state may change between requests.

### Child WorkSurface persona

#### What the model sees

Each fresh child sees its optional profile persona, assigned Surface id, compiled `Projection`, private working path, exact base revision, the required `ws commit` procedure, and the structured completion contract.

#### Token effect

The complete `surface.md` and directly referenced Block bodies consume data-dependent tokens up to the profile's approximate Projection budget, in addition to fixed commit and return instructions.

#### KV Cache effect

The persona is per-run because Surface content, revision, and working path change; it does not create a stable cross-run prefix.

## Known Limitations and Deferred Work

- **In-process child providers only** — least-authority shell environment binding depends on a local child Agent identity; remote Subagent providers are rejected.
- **macOS sandbox proof is platform-specific** — the shipped integration gate exercises the real Seatbelt profile on macOS; equivalent Landlock and Windows ACL integration coverage remains deferred.
- **No distributed Host** — the authenticated transport is a private local socket and canonical publication assumes one shared filesystem.
- **Observer containment is not yet isolated** — lifecycle listeners use ordinary Cordis event delivery and should remain non-throwing.
