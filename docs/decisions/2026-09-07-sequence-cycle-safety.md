# Sequence graph safety and missing targets

Phase 2 follows Phase 1+7, including its preserved-clip recovery contract.

## Content retention

Deleting a child timeline leaves parent sequence clips intact, like offline media.
Their timeline IDs, source windows, effects and placement remain in the document;
`missing-sequence` explains the problem. Playback duration for a missing target is
zero. Restoring the target ID restores the reference; explicitly deleting the
parent clip is the user's choice. We never cascade-delete these clips or rewrite
an original source/document to make lint pass. Existing JSON and Yjs readers
already accept missing targets and cycles, and tests now cover both full writer
merges and export/reopen. No new recovery reason is needed: `referencesRemoved`
would be false because these references were retained. `clipsPreserved` continues
to describe unplaced content recovery.

`preservedClips` is now a typed optional core Project field. It contains ownership
metadata, not placement. `collectSequenceRefs(Timeline)` deliberately excludes
these clips because they are neither rendered nor mixed. The inspector checks
all placed and preserved sequence targets, including missing owners, and checks
whether restoring an unplaced edge would form a cycle. Restoring placement must
use the insertion gate. Existing offline-media, zero-duration and loud-clip checks
apply to clips in every timeline and to all preserved clips, including missing owners. Gaps apply only to
placed clips; empty-timeline checks apply to each timeline's placed content.

## Edit rejection

The four supported sequence insertion/move/duplicate/paste entry points return
the exact original Project on refusal, preserving undo and redo identity. The
pure `sequenceEditReason` preflight exposes the same three issue codes to callers.
The web store checks that helper and shows a translated toast; the core mutators
repeat the check so non-UI callers cannot bypass it accidentally. Paste rejects
its eligible batch atomically, and moving validates before removing the source.
A move to an unknown track now preserves the original clip as well.
All current mutators operate on the root alias, so their preflight defaults to
`rootTimelineId`; Phase 6 non-root editors must pass their actual parent ID.

This compatibility choice avoids changing every existing media/text mutation to
a result union. It adds no transient rejection metadata to persisted documents
and no callback/exception side effects to pure mutations. Code that supplies an
entire project snapshot (CRDT, undo, generated projects) still needs runtime
protection; edit validation cannot establish an invariant across a merge.

## Runtime, depth and performance

`MAX_SEQUENCE_DEPTH = 8` permits eight timeline levels including the root. The
public depth query saturates at eight for cycles and overflow; internal analysis
keeps a ninth sentinel to distinguish a legal eight-level chain from overflow.
Premiere/FCP-style nested composition motivates supporting multiple levels, not
an unbounded resource promise or a claim about either editor's numerical limit.
Our conservative ceiling reserves headroom within `MAX_ASSET_TEXTURES = 24` for
source textures, transitions and effects; depth alone cannot bound a wide graph's
texture count, so the renderer's existing texture eviction remains necessary.

Iterative DFS plus strongly connected components uses visited sets and O(V+E)
time/storage with no recursive JS call stack. Shared subtrees are memoized, cycles
and over-depth subtrees contribute zero duration, and missing targets contribute
zero. A sequence span is its available child source window
`max(0, min(trimOut, childDuration) - trimIn) / speed`; its stored duration cannot
stand in for a child's current available content. Unplaced clips never extend
playback duration. The current compositor/audio paths do not render/mix sequence
sources yet, so Phase 3/4 must carry the same bounded traversal policy into nested
frame/audio evaluation (black frame/silence on failure).

`computeDuration(Project, timelineId = rootTimelineId)` replaces the Timeline-only
signature. Repository search found one production core caller: `recompute` in
`mutate-internal.ts`, called on edits, plus one existing core test. Mediabunny's
unrelated methods with the same name are unchanged. No renderer or export loop
calls this graph query per frame. Drag mutations on timelines without sequence
clips use the original local duration scan with an inline sequence-kind check and no flattened temporary array;
they never inspect unrelated timelines or build a graph. Root edits are synchronized before calculating,
so calculation sees the proposed clips rather than a stale root collection.
Lint is memoized by the inspector on content changes (timeline IDs/track-array
references, media library and preserved clips); playhead/zoom changes only compare
these references and never reopen clips or traverse graph edges; its placed graph analysis
is linear, while hypothetical restoration of preserved edges performs reachability
checks only in this static diagnostic path. The web preflight and core gate each
run at edit time, never at frame time.

## Deliberate tradeoffs

- Retain missing-target clips rather than refusing timeline deletion or cascading
  deletion: restoration remains possible and matches offline-media behavior.
- Exclude preserved clips from playback graph edges, but diagnose restoration:
  otherwise recovery-only content could silence a valid timeline.
- Saturate public depth while retaining an internal overflow sentinel: exact
  maximum depth remains usable without confusing it with a cyclic subtree.
- Keep pure Project-returning mutations plus shared preflight, accepting two
  edit-time checks in UI callers to preserve API compatibility and safety.
- Do not normalize persisted cached durations on load in this phase: loading
  retains document content and existing reader semantics; the guarded duration
  query is used at its existing edit boundary.

## Measured drag mutation cost

Compared the real `moveClip` implementation from `0b2e55f` (isolated `git archive`
copy, same dependencies) with this branch using identical 1,000-clip projects.
Each move starts from the same snapshot, moves the first clip by 100 ms, and
asserts the resulting start. After 300 warmups per implementation, eleven batches
of 2,000 calls alternate implementation order; values below are median µs/call.
These measure the core mutation itself, not persistence, React or input delivery.

| Layout | Base before optimization | Initial graph implementation | Base final run | Final implementation |
| --- | ---: | ---: | ---: | ---: |
| 1 timeline × 1,000 clips | 25.816 | 25.649 | 23.262 | 18.625 |
| 10 timelines × 100 clips | 2.942 | 23.134 | 2.579 | 2.041 |

The initial implementation caused a 7.86× regression on the multi-timeline case.
The fast path removes that regression (final ratios 0.80× and 0.79×); absolute
numbers are local microbenchmarks and not a browser responsiveness guarantee.
Sequence-bearing timelines still need guarded graph evaluation at edit time.

The inspector itself measured 0.568 µs for an empty project and 48.828 µs for
1,000 clips (same warmup/batch protocol). This is small, but its content memo
boundary enforces the no-graph-traversal-on-playback-ticks contract as projects
grow. The store subscriber is outside the memoized child; only the child owns
inspection, and it has no project-store subscription.

Validation rule: keep source files unchanged throughout a full E2E run. A dev
server hot reload during a run invalidates that run as verification evidence.
