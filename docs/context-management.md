# Fact-backed model context

WorkSurface model context follows one reconstruction path:

```text
DSH Session log + immutable Surface Revision -> Context Plan -> model adapter
```

Before prompt assembly, the adapter resolves the Surface uniquely bound to the
current DSH Session and records a downstream-ignorable
`worksurface/context-revision` event. Its manifest refers to every immutable
Revision file by path, digest, and size. Projection code never reads the mutable
authoring directory. Conversation messages remain owned by the native DSH
Session Surface and are not duplicated.

Context providers register through `ctx.contextProviders.register(...)`.
Provider calls for one occurrence run concurrently, then settle in stable
`(order, providerId)` order. Inline output is persisted in a content-addressed
runtime blob before `context/provider-settled` refers to it. Stable occurrence
identities make recovery idempotent: a restored Session replays settled facts
instead of invoking a provider again.

The Context Plan combines the native conversation projection, immutable Surface
files, and active provider occurrences. `surface.md`, conversation messages,
and required provider sections cannot be omitted. Other files and sections are
selected deterministically within the target context window. If required input
alone exceeds the budget, assembly fails explicitly.

After a request is accepted, `context/rendered` records the plan, included and
omitted item identities, token estimate, route, and content hash. It deliberately
does not contain prompt or provider bytes. All WorkSurface context events carry
`ignorable: true`, so a Harness without the plugin can safely retain and skip
them while a Harness with the plugin reconstructs the exact projection.

Compaction and tool-result pruning remain DSH Session capabilities. WorkSurface
does not create a second conversation-maintenance lifecycle.
