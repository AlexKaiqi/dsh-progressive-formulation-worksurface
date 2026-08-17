# Progressive Formalization WorkSurface

English | [中文](README.zh.md)

Progressive Formalization WorkSurface is one DeepSeek Harness plugin product. It gives a parent Agent a durable, file-native WorkSurface, an ordinary-script orchestration tool, and revision-pinned collaboration with child Agents.

The repository contains three implementation packages, not three separate plugins:

- [`@pf-worksurface/core`](packages/core) owns the immutable file store, projections, and effect journal.
- [`@pf-worksurface/cli`](packages/cli) provides the authenticated `ws` process client.
- [`@pf-worksurface/dsh`](packages/dsh) is the installable DeepSeek Harness plugin and profile bundle.

## Development

Requires Node.js `^22.19.0 || >=24.0.0` and pnpm 11.7.0.

```sh
pnpm install
pnpm check
```

The package family currently targets DeepSeek Harness `0.1.0-rc.6`. See the [`dsh` package README](packages/dsh/README.md) for installation, runtime behavior, configuration, and model-visible behavior.

## Repository scope

This repository contains only the Progressive Formalization WorkSurface plugin. Plugin Inventory is maintained in a separate repository.
