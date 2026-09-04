# Source inventory and reading order

## Tier 0: closest production or framework implementations

| Source | Why it is first | Primary paths |
| --- | --- | --- |
| OpenAI Codex | Cleanest implementation of token-budget reset plus external recall | `codex-rs/ext/history-notes/`, `codex-rs/core/src/compact_token_budget.rs`, context-window handler and tests |
| Letta Code | Most explicit product implementation of a Git-backed Context Repository | memory filesystem, Git/worktree, scanner, prompt compilation, memory tools and policies |
| AIGNE AFS | Broadest filesystem abstraction and adapter surface | `afs/core`, `afs/git`, `afs/history`, `afs/sqlite`, prompt-side AFS context |
| Agentplane | Strong source/derived split and promotion/verification machinery | context schema, reindexing, freshness, extraction transaction, finalize and verify paths |

## Tier 1: focused mechanics

| Source | Question it answers |
| --- | --- |
| Git Context Controller | What should COMMIT, BRANCH, MERGE, and bounded CONTEXT look like? |
| AgentsFS | What semantic roles should be reserved, and which operations should not be model tools? |
| agno-agi/context | How should verified providers register and expose a small capability-filtered tool surface? |

## Tier 2: pattern specimens

| Source | Use | Restriction |
| --- | --- | --- |
| context-repository | Compare typed Claim/Evidence/Decision/Policy/Event concepts | No license; study only |
| skillfoundry-harness | Compare canonical repo versus ephemeral runtime and promotion flow | No license; study only |
| agent-mem | Compare a small Git-backed `.context/` CLI with branch/merge/compact/forget commands | Young implementation; verify command semantics rather than README labels |
| agent-os | Compare a runtime-neutral filesystem protocol for binders, workstreams, receipts and handoffs | Primarily a protocol and script suite, not a model context runtime |

## Adjacent mechanism implementations

| Source | Narrow question answered | Boundary |
| --- | --- | --- |
| OpenHands Software Agent SDK | How can an append-only transcript produce a compact, API-valid model View without deleting source events? | Condensation is still lossy and is not addressable repository memory |
| Aider | How can a whole repository be rendered as a relevance-ranked map under a fixed token budget? | The map is a derived code-navigation projection, not authority |
| Axiom `agent-memory` | How can a generated small entrypoint expose selected notes inline and the rest by stable id? | Defrag/archive application is not wired end to end; no license |
| Memstead | How should schemas, CAS mutation, provenance, trust origin, error codes and the agent tool roster be enforced? | Rich knowledge-store protocol; actor role is caller-declared and archive is not per-item lifecycle |
| ACE | What does incremental grow-and-refine with evaluation feedback look like? | Research prototype; only ADD is implemented in its curator operation algebra |
| ContextFS | How can branchable filesystem state, CAS snapshots and semantic continuation records be restored safely? | Execution/filesystem checkpoint substrate, not a semantic context router |
| ACE Playbook | How can the ACE paper's delta loop be given typed persistence and tests? | Independent later implementation, not evidence about the original authors' shipped runtime |
| LangChain Deep Agents | How can one model-facing filesystem namespace route across ephemeral state, persistent store, host/sandbox files and a versioned Context Hub, while offloading large results and old history to retrievable paths? | Context Hub versions agent/skill context, but the generic backend ABI and runtime files have no common revision, archive/restore or staged publish contract; subagent message isolation is not storage isolation |
| AICTX | How can coding agents compile repo-local Work State, handoffs, decisions, failures and validation evidence into a bounded cross-session resume/finalize loop with freshness explanations? | The runtime owns a fixed JSON/JSONL taxonomy; ordinary writes lack a common revision/CAS transaction, and maintenance archive has no ordinary item restore |

Full evidence is in `32-adjacent-mechanism-audit.md`.
Deep Agents' dedicated audit is in `35-deepagents-audit.md`.
AICTX's dedicated audit is in `36-aictx-audit.md`.

## Still deferred

- Letta `mods/memfs-search`: the main Letta implementation already establishes
  bounded Git-backed retrieval; clone only if hybrid keyword/semantic scoring
  becomes a design decision.
- MemGPT and Manus: retain as historical/product context. Their public material
  is not needed to establish the concrete runtime contracts in this pass.

## Extraction order

1. Repository bootstrap contract: always-visible index, tree, descriptions, and pinned material.
2. Read/search contract: path addressing, range limits, freshness, deterministic result bounds.
3. Write/publish contract: validation, commit/revision boundary, concurrency, and provenance.
4. Lifecycle roles: working, pinned, journal, scratch, archived, and derived.
5. Window reset and recovery: what must be durable before a fresh context window is allowed.
6. Multi-agent behavior: worktree/isolation, merge, shared memory, and conflict handling.
