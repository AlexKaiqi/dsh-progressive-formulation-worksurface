# Adjacent mechanism audit

This note audits five implementations that are adjacent to, but not identical
with, a Context Repository. It uses the evidence labels from
`02-evaluation-method.md`: **I** implemented, **T** tested, **D** documented,
**C** claimed. A project is not credited for a prompt or README claim when the
mutation, projection, or recovery path is absent.

Pinned revisions:

| Source | Revision | License status |
| --- | --- | --- |
| OpenHands Software Agent SDK | `07307cb8edfcd9b4675be2761df0646d075a9c36` | MIT |
| Aider | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | Apache-2.0 |
| Axiom `agent-memory` | `72075416ce23c67d1ae7f74a1274a96e01832abd` | no repository license; study only |
| Memstead | `a0efe213329322180e42faa939e36f8ba765ccc4` | MIT OR Apache-2.0 |
| ACE | `82709de050e1db6e6ef2f07bcb0393560b94992a` | Apache-2.0 |

## What each project actually contributes

| Source | Durable authority | Window projection | Mutation/lifecycle | Strongest lesson | Not evidence of |
| --- | --- | --- | --- | --- | --- |
| OpenHands SDK | append-only Event stream | derived `View` plus condensation event | condensation changes the View, not original events | keep authoritative history separate from disposable model projection | searchable repo memory or lossless semantic archive |
| Aider | working Git repository | ranked, token-fitted code map | none for context lifecycle | construct a bounded navigation map from relevance signals | context authority, provenance, publish, or archive |
| Axiom `agent-memory` | Markdown files and Git history | selected bodies inline, remainder listed by stable id | CRUD exists; defrag apply/commit path is not wired in the CLI | a generated small entrypoint can point to durable, addressable notes | a mature automatic archive/defrag transaction |
| Memstead | schema-typed Markdown over folder or Git-backed mems | overview, schema, search, entity reads | validated CAS mutation, typed errors, provenance, separate operator policy | agent-facing context tools themselves need a tested ABI and trust receipts | verified actor identity or reversible per-entity archive |
| ACE | one evolving playbook string and saved snapshots | usually sends the playbook to the generator | useful-count updates, ADD deltas, optional embedding merge | grow-and-refine can outperform repeated monolithic regeneration | a repository protocol, concurrency control, or complete CRUD delta algebra |

## 1. OpenHands: authoritative events, disposable Views

### Implemented and tested

- **I** `Condensation` is itself an Event. It records the exact
  `forgotten_event_ids`, an optional summary and its insertion offset. Applying
  it filters those ids only from a derived list; it does not delete the source
  events. A synthetic summary id is derived deterministically from the
  condensation event id.
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/event/condenser.py:11-96`
- **I** `View.from_events()` folds the ordered Event stream. Condensation
  semantics are applied while building the View, and internal non-LLM events
  remain outside the model projection.
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/view/view.py:22-50,111-160`
- **I** legal cut points are the intersection of independently declared View
  properties. The implementation prevents a cut between a tool call and its
  result and protects whole tool loops and batches.
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/view/view.py:38-50`
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/view/properties/tool_call_matching.py:15-100`
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/view/properties/tool_loop_atomicity.py:14-21`
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/view/properties/batch_atomicity.py`
- **I** the summarizing condenser distinguishes hard token/request pressure from
  soft event-count pressure, targets roughly half the effective limit, chooses
  atomic boundaries, refuses negligible progress, and has a progressively
  truncated hard-reset fallback.
  - `sources/adjacent/software-agent-sdk/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py:99-187,254-399`
- **T** tests cover ordered condensation, multiple summaries, batch/tool-loop
  boundaries, token and event triggers, hard-reset retry, and error paths.
  - `sources/adjacent/software-agent-sdk/tests/sdk/context/view/`
  - `sources/adjacent/software-agent-sdk/tests/sdk/context/condenser/test_llm_summarizing_condenser.py`

### Boundary and lesson

This is a strong **event-log versus projection** design. It does not make the
summary lossless, and it does not offer addressable retrieval over forgotten
events to the model. The idea to borrow is narrower: a context reset should add
an explicit projection event naming what was excluded, while source facts stay
replayable. For WorkSurface, transcript compaction and Surface repository
lifecycle should remain separate state machines even if one can trigger the
other.

## 2. Aider: a budgeted navigation projection

### Implemented and tested

- **I** the repo map reserves 4,096 tokens from the model window and can expand
  its map budget when no files have been selected yet.
  - `sources/adjacent/aider/aider/repomap.py:89-167`
- **I** it extracts definitions and references, builds a file dependency graph,
  and uses personalized PageRank. Current chat files, mentioned filenames,
  mentioned identifiers, identifier shape, and reference frequency all affect
  ranking.
  - `sources/adjacent/aider/aider/repomap.py:365-574`
- **I** it uses a bounded search over the ranked prefix to select the largest
  rendered tree close to the target token budget.
  - `sources/adjacent/aider/aider/repomap.py:629-706`
- **I** caches are keyed by input sets/budget and tree fragments use path,
  selected lines and file mtime; refresh policy can be manual, always, files,
  or auto.
  - `sources/adjacent/aider/aider/repomap.py:576-625,708-725`
- **T** tests exercise refresh and forced refresh behavior.
  - `sources/adjacent/aider/tests/basic/test_repomap.py:49-159`

### Boundary and lesson

Aider's map is a high-value **derived router**, not the context source of truth.
It is code-specific and its freshness relies partly on mtime/cache policy rather
than a content-addressed input manifest. WorkSurface should borrow the projection
shape—ranked summaries plus exact paths, explicit budget and a completion
receipt—but generate it from a pinned Surface Revision. Relevance should be a
provider over semantic roles and links, not hard-wired to programming symbols.

## 3. Axiom `agent-memory`: good entrypoint, incomplete defrag

### Implemented

- **I** entries are plain Markdown. Identity comes from the filename, title
  from the heading, tags from the body, and timestamps from Git history.
  - `sources/adjacent/agent-memory/src/schema.ts:1-53`
- **I** the service implements capture/list/read/delete/update/rename and link
  diagnostics. Its `remove` operation delegates to physical delete.
  - `sources/adjacent/agent-memory/src/service.ts:23-40,42-114`
- **I** the generated `AGENTS.md` section places chosen top-of-mind bodies
  inline, lists all other entries by stable id and title, and provides concrete
  list/read commands. Sentinel comments make regeneration idempotent.
  - `sources/adjacent/agent-memory/src/agents-md/generator.ts:10-84`
- **I** every entry physically lives below `orgs/{org}/archive/`. Here
  `archive` is a storage directory name, not an item lifecycle state.
  - `sources/adjacent/agent-memory/src/persist/filesystem.ts:1-18`

### Prompt/docs ahead of runtime

- **P/T** the defrag prompt and parser describe merge/split/rename/archive and
  validate those action shapes.
  - `sources/adjacent/agent-memory/src/prompts/defrag.ts:17-79,150-226`
  - `sources/adjacent/agent-memory/test/prompts-defrag.test.ts`
- **I as framework, not concrete behavior** the XState machine declares
  scan → agent → parse → apply → generate → commit and supports injected
  actors. Its default `applyChanges` and `commitChanges` actors throw until a
  host supplies implementations.
  - `sources/adjacent/agent-memory/src/machines/defrag.ts:7-49,181-257`
- **I gap** the shipped defrag CLI reads entries, invokes the model, parses the
  decision, writes the index note and generated entrypoint, but does not execute
  the decision's actions and does not commit them.
  - `sources/adjacent/agent-memory/src/cli/defrag.ts:44-101`

### Boundary and lesson

The mature part is the **small generated entrypoint with stable ids and an
explicit on-demand read command**. The archive/defrag story is not mature enough
to copy: parser tests and a mockable workflow do not establish a real atomic
mutation path. Its binary top-of-mind versus everything-else model is also more
honest than README descriptions of richer temperature tiers.

## 4. Memstead: the strongest agent-facing contract audit

### Implemented and tested

- **I** mutation parameter structs reject unknown fields. Create/update expose
  dry-run validation, schema-controlled sections/metadata, provenance anchors,
  and a bounded author note.
  - `sources/adjacent/memstead/crates/memstead-mcp/src/tools/mutation.rs:1-69,125-239`
- **I/T** content-changing updates require `expected_hash`; mismatch has the
  typed code `HASH_MISMATCH` and returns the current hash. Dry-run applies the
  same semantic validation while intentionally bypassing only the stale-hash
  check and returns current/prospective hashes.
  - `sources/adjacent/memstead/crates/memstead-mcp/src/tools/mutation.rs:183-239`
  - `sources/adjacent/memstead/crates/memstead-mcp/tests/wire_shape.rs:809-951`
  - `sources/adjacent/memstead/crates/memstead-mcp/tests/wire_shape_lean.rs:557-704`
- **I/T** provenance anchors are stored atomically with the mutation; repeated
  anchor keys and malformed locators refuse the whole operation. Mutation role
  is append-only and tamper-evident, but explicitly caller-declared.
  - `sources/adjacent/memstead/crates/memstead-mcp/src/tools/mutation.rs:40-53,213-239`
- **T** the complete MCP tool set is pinned as a public ABI, namespaced, and
  capped below 30. CLI and MCP are tested as sibling surfaces over the engine.
  - `sources/adjacent/memstead/crates/memstead-mcp/tests/tool_surface.rs:1-159`
- **T** batch create/update and export are deliberately absent from the model
  surface because file-scale payloads and responses would flood context;
  workspace-policy mutation stays on an operator surface.
  - `sources/adjacent/memstead/crates/memstead-mcp/tests/tool_surface.rs:161-195`
- **I/T** each read/report surface declares whether it makes a verdict and the
  axes covered. Empty search/read output is explicitly not an all-clear.
  - `sources/adjacent/memstead/crates/memstead-mcp/src/coverage.rs:1-93`
- **I/T** entity reads and individual search hits carry a first-party versus
  third-party origin label derived from mount capability; read-only external
  content is described as quoted, untrusted data.
  - `sources/adjacent/memstead/crates/memstead-mcp/src/server.rs:2374-2405,7136-7240`

### Boundary and lesson

Memstead has the best implementation evidence for treating the **tool catalog,
wire schema, error vocabulary, trust labels, and coverage receipts as one tested
runtime ABI**. It is more detailed than WorkSurface should expose verbatim.
Also, caller-declared role/identity is provenance, not authorization. Its use of
“archive” usually means a sealed portable `.mem` package; entity deletion is
not a reversible lifecycle archive.

The high-value pieces to borrow are:

1. `expectedRevision`/hash on every authority-changing mutation;
2. dry-run that shares real validation and returns a prospective receipt;
3. a pinned, drift-tested model tool surface generated over the same engine as
   the human/CLI surface;
4. runtime-derived data-origin/trust labels;
5. explicit scope/coverage/truncation semantics for every read.

## 5. ACE: useful grow-and-refine idea, prototype persistence

### Implemented

- **I** each playbook bullet has a stable section-derived id plus helpful and
  harmful counters. Generator usage feedback updates those counters.
  - `sources/adjacent/ace/playbook_utils.py:13-93`
  - `sources/adjacent/ace/ace/ace.py:545-576`
- **I** the curator periodically receives the current playbook, reflection,
  evaluation context and budget and emits JSON operations.
  - `sources/adjacent/ace/ace/ace.py:578-606`
  - `sources/adjacent/ace/ace/core/curator.py:110-167`
- **I** the actual mutation algebra currently implements only `ADD`. UPDATE,
  MERGE, CREATE_META and DELETE are TODOs even though some names are accepted by
  the parser and the class docstring claims them.
  - `sources/adjacent/ace/playbook_utils.py:96-216`
  - `sources/adjacent/ace/ace/core/curator.py:327-403`
  - `sources/adjacent/ace/ace/prompts/curator.py:139`
- **I** batched proposals are constrained to ADD, reduced by another LLM call,
  then applied once. This reduces duplicate additions but is not a
  compare-and-swap transaction.
  - `sources/adjacent/ace/ace/core/curator.py:169-342`
- **I** optional embedding similarity groups and LLM-merges existing bullets.
  This is a separate whole-playbook rewrite path and keeps the first bullet id.
  - `sources/adjacent/ace/ace/core/bulletpoint_analyzer.py:273-372`
- **I** persistence is periodic and final text-file snapshots plus metric JSON;
  there is no revision manifest, provenance graph, rollback protocol, or
  concurrent publisher check in the examined path.
  - `sources/adjacent/ace/ace/ace.py:727-825`

### Boundary and lesson

ACE supports the research claim that **small accumulated deltas plus evaluation
feedback** can be a better learning loop than regenerating all context every
turn. Its repository is not evidence for Context-as-Repo infrastructure: the
playbook is one large string, most advertised operation kinds are not applied,
and persistence is snapshot files. WorkSurface can borrow the grow-and-refine
policy at the semantic layer only after its own staged revision, validation and
promotion protocol exists.

## Cross-source synthesis for WorkSurface

These adjacent sources sharpen four distinctions:

1. **Authority is not projection.** OpenHands retains the full Event stream;
   Aider builds a disposable navigation map. WorkSurface needs both concepts and
   must not let a map or summary become the only truth.
2. **A generated entrypoint is not enough.** Axiom demonstrates the useful
   entrypoint pattern and, simultaneously, how archive claims can outrun the
   concrete apply/commit path.
3. **The context-tool ABI is product architecture.** Memstead tests its roster,
   schemas, errors, trust origin, coverage and operator boundary. WorkSurface
   should do the same with a much smaller vocabulary.
4. **Semantic curation comes after transaction safety.** ACE's incremental ADD
   and feedback counters are useful curation policies, but they do not replace
   revision pinning, optimistic concurrency, validation, provenance or restore.

Therefore none of these five replaces the core WorkSurface design. Together
they support a layered target:

```text
append-only facts / immutable Surface Revision       authority
                 ↓
generated bounded index + role-aware ContextPlan     projection/router
                 ↓
bounded list/search/read with honest receipts         disclosure
                 ↓
stage → validate/dry-run → publish(expected head)     mutation
                 ↓
typed archive/restore; privileged GC separately       lifecycle
```
