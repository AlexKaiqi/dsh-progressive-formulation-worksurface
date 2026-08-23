# Progressive Formalization WorkSurface

English | [中文](README.zh.md)

Progressive Formalization WorkSurface is one DeepSeek Harness plugin product. It gives a parent Agent a durable, file-native WorkSurface, an ordinary-script orchestration tool, and revision-pinned collaboration with child Agents.

The repository contains four implementation packages. The first three form the canonical WorkSurface plugin; the Web package is an optional visualization companion:

- [`@pf-worksurface/core`](packages/core) owns immutable Surface revisions, Surface-local Work Sessions, projections, Orchestrator definitions, and the effect journal.
- [`@pf-worksurface/cli`](packages/cli) provides the authenticated `ws` process client.
- [`@pf-worksurface/dsh`](packages/dsh) is the installable DeepSeek Harness plugin and profile bundle.
- [`@pf-worksurface/web`](packages/web) adds the Conversation / WorkSurface Graph switch, the Surface DAG, and attached Session conversations to a Web profile.

The `/dsh` bundle composes `dsh-block-to-file` as its model-facing materialization layer; `/core` remains independent of the Harness runtime.

The domain boundary is: every physically flat Surface owns exactly one append-only Work Session. Delegation is file-first: a child Surface may exist briefly as an unbound recovery anchor, but it enters the WorkGraph only after one continuable Agent Session is attached through its write-once binding. Recursively following those bindings from the root produces the WorkGraph. Blocks inside a Surface are concepts, evidence, or decisions. A Block is promoted to a child Surface only when it needs an independent Agent, acceptance boundary, version, or lifecycle. Information edges come from revision-pinned BlockRefs actually consumed by a Projection, never from timestamps or filesystem nesting. The complete storage and fact-source decision is documented in [`docs/work-session-storage.md`](docs/work-session-storage.md).

The Web plugin's product-level E2E dimensions, cases, deterministic fixtures, and real DSH run records are maintained under [`packages/web/evals`](packages/web/evals/README.md) and validated during the Web package build.

Whether a real model can decide when to use WorkSurface, commit correctly, choose Block versus Surface granularity, delegate, and recover is evaluated separately under [`packages/dsh/evals`](packages/dsh/evals/README.md); static prompt assertions are not treated as model capability evidence.


## Development

Requires Node.js `^22.19.0 || >=24.0.0` and pnpm 11.7.0.

```sh
pnpm install
pnpm check
```

The package family currently targets DeepSeek Harness `0.1.0-rc.6`. See the [`dsh` package README](packages/dsh/README.md) for installation, runtime behavior, configuration, and model-visible behavior.

## Repository scope

This repository contains only the Progressive Formalization WorkSurface plugin. Plugin Inventory is maintained in a separate repository.
