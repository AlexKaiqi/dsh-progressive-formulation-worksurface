# Mature practices extracted from pinned sources

This note records implementation-backed practices. It does not treat papers,
prompts, or README claims as runtime behavior unless matching code or tests exist.

## Cross-project matrix

| Concern | Strongest source | Implemented practice | WorkSurface implication |
| --- | --- | --- | --- |
| Bootstrap | Letta, AgentsFS, Codex, AICTX | Small required entrypoint plus bounded tree/hint or compiled resume capsule; omitted material remains addressable and selection quality is visible | Keep `surface.md` small and inject an honest bounded index, not an unqualified task summary |
| Runtime-known contract | Agentplane, AIGNE, AgentsFS, Agent OS | Typed manifest/module/role registry plus an explicit owner-of-record map; content taxonomy stays extensible | Runtime recognizes authority, roles and providers, not every directory name |
| Projection authority | Letta local v1, Agentplane | Compile only from a committed/content-addressed source set | Render only `Surface@Revision`; never read accidental working-tree state |
| Addressing | Agentplane, AIGNE | Canonical path plus section/line/row sub-resource references | Add revision-pinned range and fragment references |
| Retrieval | AgentsFS, Agentplane, AIGNE, Deep Agents | Bounded tree/list/read/search with pagination, freshness and typed truncation reasons | Every partial result must return bounded scope/count/cursor/freshness evidence; do not enumerate an unbounded scanned set |
| Projection quality | AICTX | `loaded_context` explains source and selection; quality buckets expose stale, missing, unverified, demoted and obsolete inputs | Emit why-loaded and quality evidence beside the projection; never imply that selection proves correctness |
| Storage routing | Deep Agents | One file-shaped ABI routes logical prefixes across thread state, persistent store, host files or a versioned remote backend | Declare each route's authority, durability and isolation class; path syntax alone proves none of them |
| Large-result offload | Deep Agents | Persist full tool results before replacing the model-visible value with exact path plus bounded preview | Offload must fail safe and return digest, revision, media type and retention—not merely a pathname |
| Local/portable split | AICTX, Agent OS | Keep conflict-prone latest views, sessions and reports local; share allowlisted canonical histories and stable records | Portable authority and rebuildable local projections need separate declared roles |
| Mutation | Letta, Agentplane | Reasoned mutation and, for Agentplane derived extraction roots, staged validation/promotion/rollback | Separate stage/validate/publish; add immutable candidate digest, durable prepared record, one expected-head owner and startup repair |
| Mutation receipt | Agent OS, Agentplane | Validate receipt fields and publish immutable, collision-safe evidence after mutation | Bind receipts to the same atomic publish or clearly label them post-hoc; immutable does not imply transactionally coupled |
| Archive | Agentplane | Epistemic status and supersession links, rather than disappearance | Archive is a typed revision/event transition, not merely moving a file |
| Reset/recovery | Codex, Deep Agents | First-class compaction lifecycle or raw-history offload, with a recoverable path/checkpoint instead of silent truncation | Require a durable revision checkpoint before switching model windows; a best-effort path is insufficient |
| Durability and GC | ContextFS | Publish immutable objects before durable refs; recover with bounded walks; trace complete roots and fail closed before age-fenced sweep | Put these invariants below the semantic Surface layer; keep GC privileged and distinct from archive |
| Background maintenance | Letta | Isolated worktree, typed merge outcome, consume input only after merge/no-change | Curators produce staged revisions and settle only after CAS promotion |
| Tool safety | Codex, Letta, AgentsFS | Runtime-injected identity, path confinement, read/write separation, dangerous actions omitted | Model supplies target and intent; runtime supplies Surface/session/head/capabilities |

## Practices to borrow

### 1. A small, generated bootstrap surface

Letta's API-backed root-first v2 requires a root `MEMORY.md`, treats indexed child directories as deferred,
and renders a bounded tree. AgentsFS degrades its tree honestly from full tree to
depth-capped tree to top names and finally a root description. Codex limits its
history hint and leaves the rest behind retrieval tools.

Evidence:

- `sources/core/letta-code/src/agent/memory-format.ts:15-69`
- `sources/core/letta-code/src/agent/memory-filesystem.ts:336-430`
- `sources/specimens/agentsfs/internal/core/prime.go:79-139`
- `sources/specimens/agentsfs/internal/core/treebudget.go:33-136`
- `sources/core/openai-codex/codex-rs/ext/history-notes/src/extension.rs:97-150`

The bootstrap must never pretend to be complete. It needs an explicit escape
hatch to `tree`, `list`, `search`, and `read_range`.

### 2. Fix the ABI, not the author's taxonomy

AIGNE fixes a module interface and virtual mount path. Agentplane fixes a context
manifest and typed prompt-module contract. AgentsFS identifies semantic roles by
markers and reports duplicate singleton roles, rather than requiring one physical
directory layout.

Evidence:

- `sources/core/aigne-framework/afs/core/src/type.ts:107-185`
- `sources/core/aigne-framework/afs/core/src/afs.ts:35-84`
- `sources/core/agentplane/packages/core/schemas/agentplane-context.schema.json:7-117`
- `sources/core/agentplane/packages/agentplane/src/runtime/prompt-modules/model.ts:5-149`
- `sources/specimens/agentsfs/internal/core/reserved.go:7-32,58-107,163-199`

WorkSurface should allow arbitrary authored directories. Runtime-known roles and
providers belong in one versioned manifest/registry.

### 3. Build context from an exact revision

Letta compiles its prompt with `git ls-tree HEAD` and `git show HEAD:path`, so
uncommitted edits cannot silently alter the next model input. Agentplane locks the
source set with per-entry hashes and a workspace manifest.

Evidence:

- `sources/core/letta-code/src/backend/local/system-prompt-compilation.ts:60-116,223-264,346-371`
- `sources/core/agentplane/packages/agentplane/src/context/ingest-manifest.ts:12-41,151-230`

WorkSurface already has a stronger content-addressed Revision mechanism. The
missing rule is that every automatic context render must identify the exact
Revision and refuse ambiguous working-copy reads.

### 4. Make partial reads precise and honest

AIGNE exposes offset/limit reads. Agentplane addresses Markdown sections, line
ranges, and JSONL facts/entities/edges, and verifies cached result freshness.
AgentsFS ranks multiple signals and hydrates results only within a budget.

Evidence:

- `sources/core/aigne-framework/packages/core/src/prompt/skills/afs/read.ts:32-140`
- `sources/core/agentplane/packages/agentplane/src/commands/context/show.ts:25-150`
- `sources/core/agentplane/packages/agentplane/src/context/reindex-projection.ts:137-302`
- `sources/core/agentplane/packages/agentplane/src/context/search-freshness.ts:19-59`
- `sources/specimens/agentsfs/internal/core/pipeline.go:12-75,125-223,368-449`

A no-match result is not proof of absence unless the receipt says the search was
complete for the requested revision and scope.

### 5. Separate query, staging, and authority mutation

Codex separates read-only History from writable Notes and injects session/agent
identity at runtime. Letta requires a reason and returns the new commit SHA.
Agentplane validates a staged multi-file update for derived extraction roots,
promotes it, revalidates, and rolls back on observed failure. It has no expected
Git head, crash-atomic multi-file commit, or startup repair scanner.

Evidence:

- `sources/core/openai-codex/codex-rs/ext/history-notes/src/tools.rs:24-100,142-316`
- `sources/core/openai-codex/codex-rs/ext/history-notes/src/backend.rs:29-46`
- `sources/core/letta-code/src/tools/impl/memory.ts:102-159`
- `sources/core/letta-code/src/agent/memory-git.ts:1213-1277`
- `sources/core/agentplane/packages/agentplane/src/context/extraction-transaction.ts:26-160`

For WorkSurface, file edits should create a staged candidate. Only a validated
`publish(expectedRevision)` changes the authoritative head and settles an
Operation.

### 6. Treat archive as lifecycle, not storage layout

Letta correctly distinguishes archive from forget/delete, but currently expresses
archive mostly in its reflection prompt. AgentsFS also uses a gardening workflow.
Agentplane has implemented `deprecated`, `superseded`, and `forbidden_for_use`
status plus predecessor/successor relations.

Evidence:

- `sources/core/letta-code/src/agent/subagents/builtin/reflection-v2.md:80-106`
- `sources/specimens/agentsfs/internal/core/taskarchive.go:9-17`
- `sources/specimens/agentsfs/prompts/gardening.md:13-18`
- `sources/core/agentplane/packages/agentplane/src/context/extraction-writer.ts:46-62,103-145`

The useful synthesis is a typed `archive` operation that preserves bytes and
provenance, removes an item from the active projection, optionally points to a
successor, emits an event, and can be restored. Physical garbage collection is a
separate privileged operation.

### 7. Preserve a publish reserve and checkpoint before reset

Codex retains its compaction hooks and lifecycle even when token-budget mode skips
summarization. It reserves fallback budget and reconstructs from the latest
checkpoint plus a suffix rather than replaying the entire transcript.

Evidence:

- `sources/core/openai-codex/codex-rs/core/src/compact_token_budget.rs:21-92`
- `sources/core/openai-codex/codex-rs/core/src/session/token_budget.rs:159-214`
- `sources/core/openai-codex/codex-rs/core/src/session/rollout_reconstruction.rs:132-205,310-355`
- `sources/core/openai-codex/codex-rs/core/src/session/retained_context.rs:1-24`

WorkSurface should reserve enough tokens for `validate + publish + settle`. A
fresh window is allowed only after the current durable checkpoint is valid.

### 8. Keep background curation isolated

Letta gives maintenance subagents an isolated worktree, records the base head,
and returns typed outcomes such as merged, no-change, parent-dirty, conflict, or
failed. Input is consumed only after a successful merge/no-change outcome.

Evidence:

- `sources/core/letta-code/src/agent/memory-worktree.ts:119-237,386-485,521-640`

WorkSurface should use an isolated staged Revision and conditional head promotion,
not let a curator mutate the active repo directly.

### 9. Give providers one lifecycle and filter capabilities before inference

Agno Context normalizes each source into a small query/update surface, gives every
provider setup/close/status lifecycle, isolates optional-provider failures, and
removes write tools before the model runs when the caller or scheduled job is
read-only.

Evidence:

- `sources/specimens/agno-context/agents/sources.py:1-77,111-205,337-523`
- `sources/specimens/agno-context/agents/policy.py:5-118`
- `sources/specimens/agno-context/app/mcp.py:15-158`

WorkSurface should register providers declaratively, health-check them, and derive
the model tool catalog from verified capabilities. A missing optional provider may
degrade explicitly; a missing required provider must stop context construction.

### 10. Pin proposal, validation, approval, and promotion to content

Skillfoundry Harness records current/candidate/diff snapshots and hashes, binds an
approval to the proposed change digest, and rechecks candidate, validation and
canonical state before apply.

Evidence:

- `sources/specimens/skillfoundry-harness/docs/CONTEXT_REPOSITORY_CONTRACT.md:9-80`
- `sources/specimens/skillfoundry-harness/src/skillfoundry_harness/promotion.py:62-280`
- `sources/specimens/skillfoundry-harness/src/skillfoundry_harness/validation.py:254-340`

The protocol shape is useful, but its caller-supplied approver strings and local
path access are not an authority boundary. WorkSurface should bind every receipt
to trusted actor identity, authority namespace, Operation id and expected head.

### 11. Compile a bounded resume capsule with quality attached

AICTX provides one canonical `resume` operation that selects Work State,
handoffs, decisions, failures and structural entry points. Its normal/full views
target 1,200/2,400 estimated tokens and cap Markdown at 6,000/12,000 characters.
The result carries source locations, bounded `loaded_context` records and a
quality report that separates fresh, stale, missing, unverified, demoted and
obsolete material. This is stronger than returning an unexplained summary.

AICTX also separates allowlisted portable histories/shards from local-only active
pointers, latest snapshots, indexes, sessions and reports; several local views can
be rebuilt from portable records. WorkSurface should preserve that authority/view
split and attach `whyLoaded`, freshness and quality to every cold-start projection.

Evidence:

- `sources/adjacent/aictx/src/aictx/continuity/__init__.py:3609-3648,3732-3787,3797-3899`
- `sources/adjacent/aictx/src/aictx/continuity/explain.py:377-423`
- `sources/adjacent/aictx/src/aictx/continuity/quality.py:423-550`
- `sources/adjacent/aictx/src/aictx/portability.py:23-72,436-478`
- `sources/adjacent/aictx/docs/PORTABILITY.md:28-55,160-173`

The boundary matters: its categories are a fixed coding-continuity taxonomy, the
budget uses an approximate character heuristic and final truncation, and quality
is advisory. Git allowlists, union merge hints and secret scrubbing are not a
revision/CAS transaction or an authorization boundary.

### 12. Make file-shaped backends and offload receipts honest

Deep Agents gives state maps, persistent stores, host files and Context Hub one
`BackendProtocol`. Its read result validates range/total/next-offset consistency;
grep reports truncation, while glob also distinguishes budget, unreadable and
transport causes. A composite backend can route one logical namespace to
durability-specific providers without changing the model-facing read tools.

For large non-filesystem tool results, middleware first writes the full value to
`/large_tool_results/<tool-call-id>`, then leaves an exact path and head/tail
preview in the model window; if the write fails it retains the original result.
WorkSurface should borrow both the bounded read contract and fail-safe offload,
while adding content digest, source revision, provenance and retention.

Evidence:

- `sources/adjacent/deepagents/libs/deepagents/deepagents/backends/protocol.py:39-126,203-274,343-422,659-732`
- `sources/adjacent/deepagents/libs/deepagents/deepagents/backends/composite.py:228-291,300-352,459-520`
- `sources/adjacent/deepagents/libs/deepagents/deepagents/middleware/_message_eviction.py:25-162`
- `sources/adjacent/deepagents/libs/deepagents/deepagents/middleware/filesystem.py:1634-1677,3205-3279,3528-3577`

The shared path vocabulary must not hide semantics: State/Store are virtual,
`FilesystemBackend.virtual_mode` is confinement rather than a sandbox, and only
Context Hub supplies repo commits. Offload durability depends on the selected
route, and the generic tool result does not expose a revision.

### 13. Declare the owner of record and publish immutable receipts

Agent OS has a compact root manifest and a source-of-truth map for portable versus
external local state. Its receipt helper validates operation, outcome, workstream
id and revision, writes through a temporary file with `fsync`, and uses hardlink
or `O_EXCL` publication so duplicate event ids cannot overwrite evidence. Tests
exercise collision safety with concurrent receipt creation.

Evidence:

- `sources/specimens/agent-os/agent-os.yaml:1-19`
- `sources/specimens/agent-os/docs/state-protocol.md:17-110`
- `sources/specimens/agent-os/library/scripts/agent_os_state.py:18-119,121-218,221-380`
- `sources/specimens/agent-os/library/scripts/tests/test_agent_os_tools.py:570-626`

WorkSurface should make owner-of-record and projection ownership machine-readable,
then emit immutable Operation receipts. Agent OS's boundary is equally useful:
ordinary workstream updates still rely largely on documented re-read/rename/verify
discipline, and the receipt is post-mutation evidence—not an atomic expected-head
CAS coupled to the workstream write.

### 14. Enforce durability and GC below the semantic layer

ContextFS demonstrates the lower-level invariants a durable Revision store needs:
objects are content-addressed and immutable after publication; checkpoint data is
flushed and synced before the mutable ref advances; agent-state records pin typed
dependencies; recovery walks are bounded and can report degraded/compacted state.
GC discovers roots from refs, live branches and agent-state dependencies, fails
closed if discovery is incomplete, and applies dry-run, verification and an age
fence before sweeping.

Evidence:

- `sources/adjacent/contextfs/src/cas/object_store.cpp:147-253`
- `sources/adjacent/contextfs/src/cas/checkpoint.cpp:57-115,156-199`
- `sources/adjacent/contextfs/src/cas/refs.cpp:57-159`
- `sources/adjacent/contextfs/src/cas/agent_state_service.cpp:294-546`
- `sources/adjacent/contextfs/src/cas/gc.cpp:90-475`
- `sources/adjacent/contextfs/tests/unit/test_gc.cpp:130-333,385-430,460-607,635-656`

These are storage invariants, not a model context API. `write_ref` has durable
publication but no expected-old compare-and-swap, and ContextFS has no semantic
roles, bounded context projection or item archive/restore. WorkSurface should use
the substrate discipline without exposing VFS/runtime controls or physical GC as
ordinary context tools.

## Practices not to copy

- Do not create private Notes as a second task truth outside the Surface repo.
- Do not permanently pin every root Markdown file into every model request.
- Do not use a model-authored summary as the only durable checkpoint.
- Do not let `git commit` stand in for a cross-file domain transaction.
- Do not implement archive only as a prompt convention or one growing archive file.
- Do not expose physical delete/GC as a normal model tool.
- Do not permit cross-Surface reads or writes without an explicit Contract capability.
- Do not silently omit a required entrypoint, stale index, failed provider, or truncated search scope.
- Do not let provider factories and the model-visible tool catalog be maintained by separate hand-written lists.
- Do not accept caller-supplied approver identity as proof of authority.
- Do not infer persistence, versioning or sandbox isolation from a file-shaped backend or POSIX-looking path.
- Do not treat a post-hoc immutable receipt as proof that the preceding mutation was atomic.
- Do not promote conflict-prone latest views, sessions or reports into portable authority when they can be derived locally.
- Do not copy implementation or prose from Elastic-2.0 or unlicensed specimens.

## Maturity notes

- Letta provides the strongest end-to-end Context-as-Repo mechanics in this sample. Codex provides substantial window-reset/private-recall mechanics, but the combined feature is still a scoped, default-off experiment.
- AIGNE has the broadest storage/mount abstraction, but its paper is ahead of parts of the public implementation.
- Agentplane has unusually complete provenance and scoped extraction promotion machinery, but is young, lacks crash repair/expected-head promotion, and self-hosts a large amount of task evidence.
- Deep Agents is an active, well-tested adjacent runtime; its read/offload machinery is mature, while only its newer Context Hub backend is revisioned.
- AICTX has a substantial continuity runtime and test corpus, but is recent, fixed-taxonomy software; implementation maturity is not adoption evidence.
- Agent OS is strongest as a repo/ownership/receipt protocol with tested operator helpers, not as an enforced model context runtime.
- ContextFS is the strongest durability/recovery/GC substrate in the adjacent set, not a semantic Context-as-Repo product.
- GCC contributes useful Git vocabulary, but its current shell implementation is not transactionally sound enough to copy.
- AgentsFS, context-repository, Skillfoundry Harness, and agno-context are small design specimens, not evidence of broad adoption.
