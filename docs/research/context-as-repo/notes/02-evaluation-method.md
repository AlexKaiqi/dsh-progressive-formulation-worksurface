# Evaluation method

This review asks whether a system externalizes context into a durable, agent-addressable
working set. It does not treat every memory database, RAG pipeline, context compressor,
or repository map as a Context Repository.

## Inclusion test

A source is **structurally aligned** when it implements at least three of these properties:

1. context survives outside the current model request;
2. the agent receives a bounded bootstrap and can discover more material;
3. context has stable addresses or typed identities;
4. reads and writes are mediated by an explicit tool or filesystem contract;
5. changes have revisions, provenance, transactions, or replay semantics;
6. context has lifecycle states such as active, pinned, derived, archived, or superseded.

A source that answers only one narrower question is kept as an **adjacent mechanism**, not
presented as an implementation of the whole idea.

## Evidence levels

Every material claim is labelled by the strongest evidence found:

| Level | Meaning |
| --- | --- |
| `I` | Implemented in executable source at the pinned revision |
| `T` | Exercised by an automated test at the pinned revision |
| `D` | Described by project documentation but not traced to implementation |
| `P` | Prompt or agent instruction only; the runtime does not enforce it |
| `C` | Project claim or benchmark; not independently reproduced here |
| `H` | WorkSurface hypothesis inferred from evidence; not an accepted design |

`P` and `C` are useful evidence about product intent, but they cannot establish runtime
correctness. A README feature is not recorded as implemented until its read/write path is
traced or tested.

## Comparison dimensions

Each core system is reviewed across the same dimensions:

1. **Authority** — What is canonical: transcript, files, Git commit, database, event log,
   generated index, or model-written summary?
2. **Bootstrap** — What is always visible, how large may it become, and how are omissions
   disclosed?
3. **Addressing** — Can the model name a revision, file, section, range, record, or provider
   result precisely?
4. **Retrieval** — Are list/read/search bounded, deterministic, freshness-aware, and able to
   distinguish “not found” from “search incomplete”?
5. **Projection** — Is the exact set sent to the model recorded with source revisions,
   digests, token estimates, and omission reasons?
6. **Mutation** — Does the model edit authority directly, or produce a staged proposal that
   is validated and promoted?
7. **Lifecycle** — Are active, scratch, derived, archived, superseded, restored, and deleted
   distinct machine states?
8. **Concurrency** — Is there expected-head/CAS, worktree isolation, merge validation, or
   another lost-update barrier?
9. **Recovery** — Can the runtime reconstruct from durable facts without trusting the old
   model window or an uncommitted working tree?
10. **Security** — Who supplies actor identity and authority, how is untrusted context
    labelled, and which mutations are intentionally unavailable to the model?
11. **Maintenance** — How are consolidation, deduplication, ranking, archival, and garbage
    collection scheduled and verified?
12. **Evaluation** — Which behavior is covered by tests or measured experiments rather than
    examples alone?

## Non-equivalences kept explicit

- **Model compaction** reduces a conversation representation; it does not by itself create
  durable, inspectable, addressable context.
- **Progressive disclosure** controls loading; it does not by itself provide versioning,
  authority, write validation, or recovery.
- **Git-backed files** provide history; a Git commit is not automatically a domain
  transaction or an authorization boundary.
- **RAG/search** retrieves candidates; it does not define the lifecycle or truth status of
  the retrieved material.
- **Repository maps** are derived navigation aids; they are not the canonical repository.
- **Archive** removes material from the active projection while preserving identity and
  provenance; it is not deletion or garbage collection.

## Timeline method

Dates are reported separately for:

1. repository creation or first public commit;
2. first commit that implements the relevant mechanism;
3. PR creation;
4. merge or release;
5. later documentation or marketing terminology.

The date a project began and the date it adopted a Context Repository mechanism are not
interchangeable. Git history and PR metadata outrank retrospective README wording.

## WorkSurface comparison rule

Current WorkSurface behavior is established from its code, schemas, tests, and pinned local
Git revision. Design documents are used to explain intent, but an item explicitly marked
“not implemented” remains a gap. External ideas are first recorded as evidence; only a
separate document may turn them into candidate WorkSurface changes.
