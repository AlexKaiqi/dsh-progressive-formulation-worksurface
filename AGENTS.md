# AGENTS.md — dsh-progressive-formulation-worksurface

File-native, event-driven WorkSurface orchestration for DSH: durable Surfaces,
recoverable code-first Orchestrations, and a browser topology view. Packages:
`@pf-worksurface/core` (facts/contracts), `@pf-worksurface/runtime` (engine),
`@pf-worksurface/dsh` (DSH host adapter), `@pf-worksurface/cli` (the `ws` tool),
`@pf-worksurface/design` (prompt guidance), `@pf-worksurface/web` (browser UI).

## Host restart constraint (read before changing anything host-loaded)

The WorkSurface runtime runs inside the DSH host process, e.g.:

```
node /Users/kaiqidong/.local/bin/dsh --profile <profile> --port 3800 --no-open
```

**Host restart is supported from an agent session.** A plain bash script
spawned inside the session is a direct child of the host; the moment it kills
the host, the host's teardown kills the script's whole process tree before the
replacement can start. `scripts/restart-host.sh` therefore delegates the
kill+restart to a Python daemon that double-forks and calls `os.setsid()`,
moving into a new session/process group owned by launchd — outside the host's
tree — so it survives the host death and starts the replacement (verified:
log shows `old pid=…` then `new host pid=…`). Other detach mechanisms remain
unavailable (`launchctl submit` is held `pending spawn` in on-demand-only
mode; `at`/atrun does not run). If the daemon path ever fails, run the same
script from a normal terminal — it works either way:

```bash
bash scripts/restart-host.sh [profile] [port]
# default: profile=worksurface-full-promptfix-20260909, port=3800
# logs: /tmp/dsh-host-restart-<profile>.log
# optional: WS_RESTART_GRACE=<seconds> delay before killing the old host
```

## Which changes need a restart vs. a refresh

| Artifact | Loaded | Change applies after |
| --- | --- | --- |
| `@pf-worksurface/dsh` `lib/` (session admission, engine) | host boot | host restart (script above) |
| `@pf-worksurface/web` `client.js` (browser GUI bundle) | host boot / page load | host restart; browser reload after |
| `@pf-worksurface/web` `styles.css` | per request | browser hard refresh only, no restart |
| `@pf-worksurface/web` `index.js` (server API) | host boot | host restart |
| authored Surfaces / Orchestrations under `$DSH_WORKSURFACE_ROOT` | read live | `ws sync` re-admits; no restart |

## Build + install cycle for the profile

- Build a package: `cd packages/<pkg> && npm run bundle` (runs tsdown + tests).
- Install into the live profile's `node_modules` (e.g.
  `~/.dsh-scenarios/<profile>/profiles/<profile>/node_modules/@pf-worksurface/<pkg>/`),
  backing up the previous `lib/`/`client.js` first.
- Then apply per the table above. A restart performed via the script above is
  independently verifiable from its log (`old pid=…` / `new host pid=…` and the
  new host's startup URL); confirm from the log rather than assuming.

## Working conventions

- `ws sync` / `ws list` / `ws run` / `ws publish` / `ws emit` are host
  operations; `run`, `publish`, `emit` require a managed Surface Turn or the
  injected host binding (`$DSH_WORKSURFACE_SOCKET`).
- The web topology is **projected in full**: `/worksurface-map/api/topology`
  returns every Surface and Registration (legacy v4 + code-first) with runtime
  Event evidence, regardless of connectivity. The UI shows the whole graph and
  does not cluster nodes into subgraphs; interaction is selection-driven (click
  a Surface to inspect and advance). The graph itself is regenerated from the
  live topology snapshot on every refresh.
