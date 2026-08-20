# WorkSurface Web E2E evaluation

This directory versions the product-level evaluation contract for `@pf-worksurface/web`.

- `suite.json` defines evaluation dimensions, cases, expected outcomes, and required evidence.
- `fixtures/` and `seed.mjs` create the deterministic three-node, two-edge graph used by release cases.
- `runs/` stores immutable records from real DSH browser executions.
- `validate-suite.mjs` enforces catalog coverage and release-run completeness.

See [README.zh.md](./README.zh.md) for the complete runbook and maintenance rules.
