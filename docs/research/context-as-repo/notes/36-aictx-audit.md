# AICTX mechanism audit

Pinned source: `oldskultxo/aictx` at
`aa5efbd0e3f35f5a307b70556c4b931f89c4019e` (`v7.0.1`, MIT).

Evidence labels follow `02-evaluation-method.md`: **I** = implemented,
**T** = exercised by this repository's tests, **D** = documented, and **C** =
project claim/configuration. The audit distinguishes repository-local storage
from a revisioned Context-as-Repo authority.

## Classification

AICTX is a strong **adjacent implementation** and a useful counterexample for
WorkSurface. It is a repo-local continuity runtime with a real startup and
finalization loop:

```text
resume -> bounded continuity capsule -> normal agent work -> finalize -> later resume
```

It persists inspectable operational facts under `.aictx/`, can share a selected
subset through Git, exposes the lifecycle through CLI and MCP, and provides
freshness and selection explanations. It is not, however, a general revisioned
context repository: the runtime owns a fixed set of JSON/JSONL categories,
ordinary updates are direct file rewrites/appends, and there is no common
revision/CAS/transaction or item-level archive/restore protocol.

That makes it closer to **repo-local operational continuity as files** than to
WorkSurface's intended **arbitrary authored surface plus runtime authority and
derived projection**.

## Evolution timeline

Dates below are author timestamps in the cloned Git history, not adoption
claims.

| Date | Evidence | Relevant change |
| --- | --- | --- |
| 2026-04-16 | `c144d1d` | Initial public repository scaffold. |
| 2026-04-24 | `88eb69b` through `4c0c9ca` | Continuity storage, persistent session identity, unified loader, handoff/decision/failure memory, and continuity-first final summary. This is the first clearly relevant Context-as-Repo-adjacent implementation, eight days after repository creation. |
| 2026-04-25/26 | `9295a9e` through `e474ae8` | Optional RepoMap, bounded incremental refresh, structural scoring, and bounded projection into continuity. |
| 2026-04-27 | `a03d434`, `aa5fa9a`, `8097a44` | Work State and branch-safe loading. |
| 2026-04-28 | `9dc97fc` | Opt-in Git-portable continuity. |
| 2026-04-29 | `89ad3b7` | Age/cap based record compaction into gzip archives plus manifests. |
| 2026-05-20 | `6ba4835` | MCP tools/resources and runner plugin integrations. |
| 2026-05-24/25 | `6157222`, `16deca6` | Continuity quality scoring, lifecycle diagnostics, and task context packs. |
| 2026-06-01/08 | `b50d809`, `8737742` | Continuity guard and 7.0 lifecycle hardening. |

## What is actually implemented

### 1. A fixed, runtime-owned repo schema

**I/D.** `state.py` defines concrete paths for Work State, continuity,
strategies, failures, metrics, RepoMap, and other subsystems. The public docs
classify the main durable artifacts as:

- `.aictx/tasks/threads/*.json` and event JSONL;
- handoff and decision JSONL;
- failure, strategy, area, and semantic-repo records;
- local session, latest snapshot, metrics, resume capsule, quality, and RepoMap
  derivatives.

The split between portable canonical records and local-only latest/derived
snapshots is explicit in `docs/PORTABILITY.md`. In particular, the active-task
pointer, latest handoff snapshot, resume capsule, RepoMap index/manifest/status,
metrics, and reports stay local; selected histories and shards can be committed.

This is a mature operational schema, but application categories and paths are
part of the runtime contract. It does not accept an arbitrary authored
work-surface tree plus a small role/load-policy manifest.

### 2. Bounded startup compilation and progressive routing

**I/T/D.** `build_resume_capsule()` combines checked Work State, latest/recent
handoffs, decisions, failures, strategy reuse, RepoMap entry points, execution
contract, lifecycle warnings, and quality evidence. Normal output targets 1,200
estimated tokens and 6,000 characters; full output targets 2,400 tokens and
12,000 characters. If the rendered normal capsule exceeds the character limit,
selected lists are reduced and the Markdown is finally truncated.

RepoMap is optional and rebuildable. It stores file/symbol metadata, performs a
bounded quick refresh (default 300 ms and 20 changed files), reports partial or
stale refresh state, and returns at most a small number of structural entry
points. Query scoring is deterministic lexical/path/symbol scoring, not semantic
RAG.

The strongest practice here is not the ranking heuristic itself. It is the
combination of:

- an always-known `resume` entry point;
- a bounded compiled projection;
- source paths and stable-ish source ids for selected items;
- `loaded_context` / `why_loaded` explanations;
- quality/freshness warnings beside the projection;
- canonical records kept separate from rebuildable indexes and reports.

The budget is approximate (`len(markdown) // 4`) and the last-resort character
slice can cut structure. It does not reserve model output/tool-call budget and
is not a general window manager.

### 3. Conservative branch-sensitive task continuity

**I/T/D.** Work State captures branch, HEAD, dirty flag, changed files, and a
timestamp. Loading behavior is explicit:

- same branch loads, with warnings if HEAD or dirty state changed;
- a clean state from another branch loads if the saved commit is reachable;
- dirty cross-branch state or an unmerged saved commit is skipped;
- a portable thread chosen without a local active pointer must contain Git
  context or is treated as ambiguous.

This is a useful freshness gate. It is not concurrency control: `save_work_state`
directly rewrites the thread snapshot, rewrites the active pointer, then appends
an event. `update_work_state` performs read/merge/write without an expected
revision, file lock, or cross-process compare-and-swap.

### 4. Explicit source/derived and local/portable boundaries

**I/T/D.** Generated-path guards tell agents not to edit `.aictx/` directly;
`.aictx/memory/source/` is the explicit editable exception. Portable continuity
uses an allowlist, keeps conflict-prone latest snapshots local, derives those
snapshots from portable histories/shards when needed, installs union-merge hints
for append-only JSONL, and scrubs secret-shaped values before portable writes.

This separation is worth borrowing conceptually. Two caveats matter:

1. `merge=union` reduces text conflicts but does not give semantic uniqueness,
   ordering, or transactional consistency.
2. secret scrubbing is defense in depth, not an authorization or information
   classification model.

### 5. A broad but capability-profiled agent tool surface

**I/T/D.** The local stdio MCP server shares implementation with the CLI. It
defines `readonly`, `standard`, and `full` profiles. Read-only tools cover
resume, task-context compilation, task inspection, quality, guards, RepoMap,
doctor, and reporting. Standard adds finalize and Work State mutations. Full
adds decision/handoff/failure writes, RepoMap refresh, and portable compaction.

Inputs have closed schemas for the core tools, list/text size limits, repository
existence checks, and secret-shaped text redaction. The MCP boundary intentionally
does not expose arbitrary shell or generic file read/write.

This is real capability filtering, but the namespace contains many
domain-specific verbs. It lacks one uniform address/read/write/lifecycle ABI,
stable fragment/range references, expected revision on mutation, and a single
publish boundary. It is therefore a good source for tool **permissions and
bounds**, not a model for WorkSurface's final tool granularity.

### 6. Quality, maintenance, and archival are distinct

**I/T/D.** Continuity quality marks selected items fresh, possibly stale,
demoted, obsolete, unverified, or missing. The defaults are advisory age bands
(7/30/90 days), combined with path existence, role, confidence, carried contract
gaps, and RepoMap/view state. This is unusually honest for a small continuity
runtime: it exposes uncertainty instead of silently treating every stored note
as truth.

`runtime_compact.py` also implements maintenance archival. It plans and, on an
explicit apply, moves aged/capped metrics, strategies, resolved failures,
decisions, and workflow learnings into gzip JSONL under `.aictx/archive/`, writes
a compaction manifest, and keeps malformed JSONL rows in the live file.

That archival is **not** a first-class context lifecycle:

- it is an internal maintenance command, not a standard/full MCP item action;
- selection is hard-coded by record category, age, caps, status, and path
  existence;
- archived rows have no stable logical item state or ordinary restore command;
- apply appends archive files and then rewrites live files one artifact at a
  time; there is no multi-file transaction or crash-recovery journal;
- deletion/GC, demotion, logical archive, and reversible restore are not modeled
  as separate generic operations.

It is still a valuable example of dry-run planning, corruption preservation,
bounded retention, and an auditable maintenance manifest.

## Verification status

- Source checkout is clean at the pinned revision.
- The project contains 69 `test_*.py` files and 561 top-level `test_*`
  functions. The audit inspected targeted coverage for resume capsules,
  Work State branch safety, MCP permissions/tools, continuity quality, RepoMap,
  portability, and compaction.
- The local environment has no `pytest` module, so the suite was **not executed**
  in this audit. No dependency was installed solely to manufacture a green
  result.
- `python3 -m compileall -q src` succeeded.

Accordingly, features above are labeled **I** where source control flow was
inspected and **T** only where the repository contains focused tests; this note
does not claim those tests passed locally.

## Maturity and adoption caution

AICTX has packaging metadata, many releases, CI, docs, runner integrations, and
a substantial test suite, so it is more than a prompt specimen. Its entire
public Git history at the pinned checkout spans only 2026-04-16 through
2026-06-17, however. Rapid version count is not the same thing as external
production adoption. GitHub/PyPI popularity and downstream usage must be reported
separately from implementation maturity.

## What WorkSurface should absorb

The directly reusable design lessons are:

1. Make one startup query canonical, bounded, and inspectable.
2. Return receipts explaining each selected item's source, role, confidence,
   freshness, and reason for loading.
3. Keep latest/cache/report projections local and rebuildable; make only durable
   authority portable.
4. Treat branch/revision compatibility as a load gate, not just metadata.
5. Separate read-only, ordinary mutation, and maintenance/privileged capabilities.
6. Make retention a dry-run plan with a manifest, and preserve malformed records
   rather than silently dropping them.
7. Carry validation gaps and discarded paths as bounded operational facts rather
   than hidden reasoning.

The parts WorkSurface should not copy are the fixed taxonomy as its core ABI,
direct non-CAS file mutation, union merge as semantic concurrency, approximate
capsule truncation as the only budget mechanism, or physical gzip placement as
the definition of archive.

## Precise difference from WorkSurface

| Dimension | AICTX | WorkSurface current/intended direction |
| --- | --- | --- |
| Primary unit | Fixed continuity records and latest snapshots inside the code repo | Surface with arbitrary authored files plus immutable Revision/Event/Contract/Operation authority |
| Bootstrap | Generated runner instructions call `resume`; capsule compiles fixed sources | DSH binds a surface revision and injects locators/turn brief; current fact-backed auto-load is the immutable bound revision |
| Progressive disclosure | Bounded capsule plus optional lexical/symbol RepoMap | ContextPlan/provider projection exists, but arbitrary file selection and transcript budgeting are not yet complete |
| Addressing | Category-specific path/id fields; RepoMap file/symbol paths | Current context refs cover file, session-event, and blob; range/fragment/provider refs remain a gap |
| Mutation | Many domain-specific direct JSON/JSONL writes | Publish/apply/event machinery is stronger, though ordinary v5 apply still lacks cross-instance atomic CAS |
| Revision/concurrency | Git context used as a compatibility signal; no common expected-head write | Immutable revisions and subject-lock publish CAS exist; apply validation needs hardening |
| Archive | Age/cap maintenance into gzip; no ordinary restore | No context archive/restore yet; should be a logical reversible state transition, not a directory convention |
| Recovery | Diagnostics and branch-safe skip; no multi-file write-ahead recovery | Operation/event ledgers offer a stronger recovery foundation, though production maintenance/provider paths are incomplete |
| Scope | Coding-repository continuity | General task/execution-state surface coordinated by DSH |

The key synthesis is that AICTX validates the value of a repo-local continuity
template, but also demonstrates why WorkSurface needs a smaller stable runtime
contract than a hard-coded directory taxonomy: runtime should know authority,
addressing, projection receipts, publish semantics, and lifecycle—not every
future category of knowledge.
