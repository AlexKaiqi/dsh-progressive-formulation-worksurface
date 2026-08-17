# @pf-worksurface/core

English | [中文](README.zh.md)

`@pf-worksurface/core` owns the file-native WorkSurface domain: immutable content-addressed revisions, atomic `HEAD` publication, validated working-copy commits, direct-reference Projections, and replayable effect records. It has no dependency on the DeepSeek Harness Agent loop.

## File contract

A Surface is a directory containing `surface.md` and `blocks/<block-id>.md`. Runtime-owned YAML front matter binds each document to its Surface and Block identity; editable Markdown remains ordinary UTF-8 text. References use `[[block:<surface-id>/<block-id>]]`.

Creating a Surface instantiates runtime-owned identities into a template. Committing validates the entire working copy, rejects dangling references and metadata/path mismatches, forbids physical Block deletion, and compares the caller's base revision with the current `HEAD`. Every accepted snapshot is stored under its SHA-256 revision before an atomic `HEAD.json` update publishes it.

## Public API

`WorkSurfaceStore` provides `newSurface`, `checkout`, `commit`, `readHead`, `readSnapshot`, `readBlock`, `validateOutputRefs`, and `history`. Mutating calls require an attempt id and stable idempotency key. Reusing a key with the same request returns the recorded result; reusing it with different parameters fails with `idempotency-key-conflict`.

`ProjectionCompiler.compile` preserves the complete `surface.md`, expands directly referenced Blocks in file order, pins every expanded Block revision, and truncates Block bodies against the configured budget. `compilePinned` rebuilds the same Projection from explicit revision pins.

`WorkSurfaceError` carries a stable `code` and JSON-safe `details`. Callers should branch on the code rather than message text.

## Model Experience

Indirectly, through `@pf-worksurface/dsh`, which inserts a compiled file Projection into each delegated child Agent's persona.

#### KV Cache effect

No direct effect; the consuming plugin owns request assembly and cache-prefix behavior.

## Known Limitations and Deferred Work

- **Direct references only** — Projection expansion does not recursively expand references found inside Block bodies.
- **Approximate token budgeting** — the compiler reserves four characters per requested token instead of invoking a model-specific tokenizer.
- **Single-host filesystem coordination** — atomic files and recoverable locks protect concurrent local processes; distributed writers require a different publication backend.
- **Logical deletion only** — callers may change status metadata, but a commit cannot physically remove an existing Block.
