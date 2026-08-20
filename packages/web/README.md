# @pf-worksurface/web

Web-only companion for `@pf-worksurface/dsh`. It adds a “对话 / 工作面图” switch to the DSH Web client and renders the top-level Session's WorkGraph.

- A card is one independent Surface and its bound Agent Session.
- Card content comes from `surface.md`; Blocks are attached within the card.
- Lines are revision-pinned Block information dependencies, not structural parent links.
- The detail drawer shows the Surface and the committed conversation projected from its Session.

The package intentionally depends on `webServer` and `sessions`; the canonical WorkSurface package remains headless-compatible.

## Evaluation

The versioned product-level E2E evaluation contract, deterministic fixtures, seed command, run history, and maintenance rules live in [`evals/`](./evals/README.md). `npm run eval:check` is part of the package build, so broken case coverage or incomplete release records fail validation.
