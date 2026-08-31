# Fact-backed model context

This document describes the current implementation in `packages/dsh/src/context/`. It does not define a generic Surface addressing theory.

## Authoritative inputs

`WorkSurfaceContextRuntime` builds model input from:

```text
DSH Session events / session.surface
+ immutable Revision manifest for the bound Surface
+ settled provider occurrence sections
        ↓ buildContextPlan
ContextPlan
        ↓ ModelContextAdapter.render
RenderedContext + RenderManifest
```

DSH owns conversation history. Surface files are resolved through `RevisionStore`; inline provider text is first persisted under `runtimeRoot/context/blobs/<sha256>.txt` and then referenced by Session facts.

## Implemented references

`ContextContentRef` currently supports exactly:

- `worksurface-file`: `surfaceId + revision + path + contentHash + size`;
- `session-event`: `sessionId + seq + contentHash`;
- `blob`: `id + contentHash`.

There is no generic `adapter + locator + boundary` protocol, file-fragment reference, database locator, or external-artifact adapter yet.

## Surface revision projection

`publishRevision()` reads an immutable Surface Revision, creates one `worksurface-file` reference per file, and appends a `worksurface/context-revision` fact to the bound Session. `foldWorkSurfaceContext()` reconstructs the current Revision and manifest from those facts.

In the current ContextPlan, `surface.md` is `required` with `never` omission. Other Surface files default to `high` priority and `whole-item` omission.

## Provider occurrences

Providers run for registered `analysis`, `acceptance`, `recovery`, or `maintenance` occurrences. Session facts record creation, each provider settlement, consumption, and end. Providers are stably ordered by `(order, providerId)` and currently invoked sequentially. Required-provider failure prevents continuation.

Supported lifetimes are `request`, `phase`, `until-revision-change`, `until-event`, and `session`.

## Planning and rendering

`buildContextPlan()` derives conversation items from `session.surface.nodes`, Surface file items from the latest context Revision, and injection/recovery items from active occurrences. Every item records its content ref, source fact seqs, priority, omission policy, lifetime, and optional token estimate. `planId` is a digest of the canonical plan.

The default adapter includes every `required` or `never` item first and fails if those exceed the budget. It then admits whole items in `high → normal → low` order. `RenderManifest` records included and omitted item IDs, token estimate, model target, and a content hash—not the original content.

## DSH boundary

WorkSurface context extension events are registered as downstream-ignorable DSH Session event types. Compaction, pruning, and the `Session → Turn → Step → Tool Call` lifecycle remain DSH responsibilities.

There is no implemented `Episode` in context management. ContextPlan, provider occurrence, Turn, and Step must not be renamed or summarized as one.
