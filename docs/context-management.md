# Fact-backed model context

A Surface is an addressable, continuously maintained, structured work context—not a predefined set of files. The input for one model call is built by Context Projection:

```text
DSH Session Log
+ Surface Materializations
+ WorkSurface EventRefs
+ Provider Outputs
        ↓
Context Snapshot / Context Plan
        ↓
Model Adapter
```

DSH `session.surface` remains the sole owner of conversation history; WorkSurface does not duplicate transcripts. The first DSH adapter resolves the bound Surface, then providers determine which context that Surface exposes for the current problem. File trees, database rows, external artifacts, and event ranges are provider/materialization types. The general protocol does not require `surface.md` or fixed sections.

Every candidate item has a logical address: `SurfaceId + adapter + locator [+ boundary]`. A locator may identify a file fragment, part of a structured object, an event range, or an element inside an external artifact. A working address without a boundary follows continuously maintained current content. Replay, cross-Surface references, and event causality require an address pinned to a Revision, EventRef, Session event boundary, or external version.

Maintenance continues between model calls. The model edits authorized Materializations with ordinary tools, and later Turn/Step Context Projections select from the latest allowed state. A Surface is therefore a durable, model-accessible work representation, not a prompt that must be injected in full on every Step.

These advances are organized as Episodes. An Episode contains or references the context boundary, model steps, tool calls, Surface changes, results, and evidence for one bounded advance. Later Episodes continue from the latest allowed state of the same Surface. An Episode neither copies the DSH transcript nor presumes a one-to-one mapping to a Turn or Step.

Custom Events emitted during an Episode may carry small values inline in their payload or carry content refs to files, Surface fragments, blobs, or external artifacts. Context Projection resolves those refs through adapters. Refs used for replay, cross-Surface transfer, or acceptance evidence must pin a boundary; working refs may only read current content.

Every input is pinned to a reconstructible boundary: file materializations use immutable Revisions, DSH history uses a stable Session event boundary, WorkSurface facts use EventRefs, and external providers use a verifiable version or content digest. A Revision is therefore a snapshot for a file materialization, not the complete content fact of a Surface.

The Context Plan classifies every candidate item:

- `required`: must enter the current call; overflow fails explicitly;
- `included`: actually entered the model input;
- `omitted`: discovered but excluded by budget or policy, and must not be described as consumed by the model.

Providers for one occurrence may run concurrently and settle in stable `(order, providerId)` order. Recoverable output is persisted as a content-addressed object or stable external reference before the Context Snapshot refers to it. Recovery reuses settled facts instead of repeating unknown side effects.

After request acceptance, the render audit records only the Context Plan, included/omitted/required identities, token estimate, model route, and content hash—not prompt or provider bytes. Related WorkSurface context events remain downstream-ignorable so a Harness without the plugin can retain and skip them while an installed plugin reconstructs the projection.

The WorkSurface advancement-control layer injects only a few stable entry points and location pointers. Trusted implementation code fills internal SessionId, Turn, InstanceId, ActivationId, causality, and capability fields. This does not require DSH to expose an identically named Runtime. The model continues to use Bash, Zsh, Python, Node, and ordinary file operations on projected content.

Compaction, tool-result pruning, and the `Session → Turn → Step → Tool Call` lifecycle remain DSH responsibilities. WorkSurface does not create a second conversation-maintenance mechanism.
