# Work Session storage and graph derivation

## Decision

A WorkSurface and a Work Session are the state and history facets of one work
unit. Every Surface owns exactly one append-only Work Session. All Surface
directories are physical siblings; parent/child relationships are facts in the
parent Work Session rather than filesystem nesting.

There is no separate canonical WorkGraph document or global Graph event log. A
WorkGraph is a read-only projection obtained by recursively folding the root
Surface's Session and the child Sessions it names.

An Agent Session may be attached to a Work Session when an Agent executes that
work unit. The attachment is immutable and one-to-one, but it is not the Work
Session itself: draft Surfaces have a Work Session before an Agent starts.

## Canonical layout

```text
<root>/
  canonical/
    surfaces/
      <surface-id>/
        HEAD.json
        commits/
        revisions/
          <sha256>/
            surface.md
            blocks/
        session/
          header.json
          HEAD.json
          events/
            000000000000.json
            000000000001.json
    orchestrator/
      definitions/
        <sha256>/
          manifest.json
          program
  runtime/
    orchestrator/
      runs/
      agent-effects/
      attempt-results/
    effect-journal/
    locks/
```

The layout deliberately keeps all `surfaces/<surface-id>` entries at the same
depth. A child can be discovered only through its parent's accepted
`child/created` event. An unreferenced directory is an orphan, not a member of a
Graph.

## Sources of truth

Each kind of fact has one authority:

- `session/events` explains how one Surface was created, revised, and
  orchestrated.
- `revisions` contains the exact immutable Surface and Block bytes named by
  Session events.
- `orchestrator/definitions` contains the exact immutable program and manifest
  named by orchestration events. A control program may also be read from the
  public attempt workspace (a committed `work/control/` file); it is stored once
  by content in the same directory, so re-running the same control re-executes
  the same immutable definition against current workspace state.
- `binding.json` is the write-once delegation record naming the one Agent
  Session that executes a Surface, the exact Projection pins it consumed, and
  the exact committed output revision it produced.
- Agent Session logs explain Agent-local turns, tools, and messages. Delegation
  records and events refer to their Session ids without copying their internal
  events.

Both Surface `HEAD.json` and Session `HEAD.json`, along with Graph snapshots,
run status, and UI indexes, are materialized views. They may be deleted and
rebuilt from canonical events and immutable content. The Surface head is folded
from `surface/created` and `surface/revision-published`; the Session head is
folded from the last contiguous event. Delegation records are not rebuildable
views: the exact input pins of one delegated execution are write-once facts.

The effect journal is an execution mechanism for idempotency and crash
reconciliation. Its mutable `started`/`completed` records are not domain history.

## Event stream

Each event has a contiguous Surface-local sequence number. The sequence is the
accepted observation order for persistence and replay; it does not manufacture a
causal relationship between parallel siblings.

```ts
interface WorkSessionEvent<T, D> {
  version: 1
  surface: SurfaceId
  seq: number
  eventId: string
  type: T
  data: D
  createdAt: string
  causationId?: string
  correlationId?: string
  attemptId?: string
  idempotencyKey: string
}
```

The initial vocabulary is intentionally small:

- `surface/created` establishes the work unit and its immutable structural
  parent.
- `child/created` makes a direct child reachable from the parent Graph.
- `surface/revision-published` records an accepted content revision and its base.
- `orchestrator/defined` pins an immutable definition.
- `orchestrator/run-started` and `orchestrator/run-completed` or
  `orchestrator/run-interrupted` or `orchestrator/run-failed` explain one
  execution attempt.

Agent/Session attachment is not a domain event. Which Session executes a
Surface, with which exact input pins, and to which committed output is a
write-once delegation record per Surface (`binding.json`), and the parent/child
boundary between Sessions is owned by the DSH Session tree (`parentSession` in
the durable Session header). rc.6 streams that still contain
`agent/session-bound`, `agent/session-completed`, `child/session-started`, or
`child/session-completed` facts fail fast as canonical corruption with an
actionable message.

Events are past-tense accepted facts. Commands and rejected validation attempts
do not enter the domain stream. A started external execution does enter the
stream before launch so recovery can distinguish an unknown outcome from work
that never started.

## Recursive composition

The parent records only the child boundary: creation (in its Work Session) and
the child's launch identity, pinned input, and accepted output (in the child's
delegation record). The child Session owns its internal work. If the child
creates more Surfaces, the same rule applies recursively.

Every canonical fact belongs to the nearest Work Session or delegation record.
The root Session can therefore explain the complete process by recursively
following child ids, while each local stream remains bounded and independently
replayable.

Structural ownership is a tree. Revision-pinned information dependencies may be
a DAG: a child Projection can consume Blocks from several sibling or ancestor
Surfaces. Those dependencies are derived from the exact input pins recorded in
the delegation record, never from timestamps or directory ancestry.

## Publication and recovery

Immutable bytes and commit metadata are written before the event that publishes
them. A crash before the event may leave an unreachable orphan, which is safe to
collect. Appending the event is the domain commit point. The Surface lock remains
held while its materialized `HEAD.json` is advanced. A missing or older head is
repaired by replay; a head that cannot be explained by the event stream is
canonical corruption.

Operations use a stable idempotency identity. Reconciliation must ensure both the
immutable commit and its corresponding Work Session event exist; finding the
content commit alone is not sufficient completion.

For an external effect, the parent first records `orchestrator/run-started`, then
launches the process, and finally records exactly one terminal outcome. Recovery
reconciles a non-terminal run instead of blindly executing it again.

## Invariants

1. A Surface directory has exactly one Work Session header with the same
   `surfaceId`.
2. Session event `seq` values are contiguous from zero and event ids are unique.
3. `surface/created` is event zero and agrees with immutable Surface metadata.
4. A child is reachable only after one `child/created` event in its parent.
5. A child has exactly one structural parent; cycles are invalid.
6. An Agent Session id and a Surface may each participate in at most one
   delegation record.
7. A delegation input names existing immutable revisions.
8. Completion names an existing revision of the same Surface and occurs once.
9. Revision publication advances from the recorded base revision.
10. Parent completion cannot silently abandon live child work; children must be
    terminal or explicitly transferred before the parent becomes terminal.
