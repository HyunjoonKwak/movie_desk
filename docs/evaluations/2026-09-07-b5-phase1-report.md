# B′5 Phase 1 + 7

Branch: `HyunjoonKwak/codex-b5-phase1`. Base: `6159223`.
The previous incomplete implementation is completed in this worktree; schema,
CRDT, production integration, regressions and documentation belong to one commit.

## Implementation and decisions

- SequenceClip is the fifth closed clip variant; unknown kinds and malformed
  nested children fail the load.
- JSON writes v2. Versionless library/snapshot rows and v1 envelopes migrate in
  memory by shape: either nested field selects strict current parsing; neither
  selects legacy migration. Partial nested shapes never fall back to v1.
- All timelines and the root alias survive JSON, library, snapshots and CRDT.
  Root-alias compatibility writers normalize before validation.
- CRDT v3 uses per-timeline metadata, scoped track/clip order and JSON-tuple flat
  clip keys. Same IDs in different timelines do not collide.
- v2 CRDT conversion stages and fully validates on an isolated Y.Doc before one
  update is applied. Legacy roots and a complete pre-migration encoded update
  remain available for recovery.
- Hydration failure throws NestedTimelineError and blocks subsequent live/library
  writes, with a persistent error badge and reason. Startup cannot flush before
  restoration; ordinary hydration no longer immediately rewrites the document.
- Read-triggered library migration and preview cache maintenance do not rewrite
  original rows. Actual edits create current-shape saves. Fresh projects remain
  eligible for initial library persistence; an active ID without a library row
  still opens its live document after an abrupt reload.

Full rationale: [nested persistence decision](../decisions/2026-09-07-nested-persistence.md).

## Round-trip and failure tests

All of these are implemented and executed, not merely prepared:

1. v1 JSON open → current envelope save → reopen, preserving existing fields.
2. v1 library row open without mutation → edit → v2 save → reopen.
3. v1 snapshot open without mutation → edit → new snapshot save → reopen;
   original snapshot remains unchanged.
4. Frozen independent v2 CRDT fixture → atomic v3 migration → edit → update
   transfer to a fresh Y.Doc → reopen. Exactly one source update is emitted;
   saved backup restores the exact original encoded state.
5. Nested JSON/library/snapshot round trips preserving root identity and children.
6. Nested CRDT reopen → immediate rewrite → inactive-child edit → third-document
   reopen, including colliding track/clip IDs in separate timelines.
7. Actual live-doc/store hydration and inactive-child-only flush; library debounce
   also observes children with an unchanged root reference.
8. Production CRDT candidate omission of timelines, rootTimelineId, or both
   fails strict parsing and leaves the encoded source unchanged.
9. Invalid v2 metadata, missing tracks/clips/media, and failed staging preserve
   all original encoded bytes and schema version.
10. Malformed nested library/snapshot loads and invalid writes preserve original
    rows; pre-sync edits and post-failure edits cannot overwrite failed hydration.
11. Preview cache maintenance after restoration preserves both library and CRDT
    originals until an actual edit.

## Validation

Final source unit counts: core **162**, web **756**, desktop **72**, scripts **11**
(**1,001 total**). Focused persistence: **136/136**. Lint passes with existing warnings.
**Final pnpm gate: 9/9 PASS. Full E2E: 68/68 PASS twice (2.6m and 2.7m)** on
unchanged production source, after checking port 32119 with lsof before each run.
[Gate evidence](2026-09-07-b5-phase1-gate.md).

The first full browser run failed six cases: obsolete v1/version and generic
error-message expectations, plus fresh-project initial-save/abrupt-reload
regressions. These were fixed; the affected E2E group passed **16/16**.
A subsequent full run failed one audio-import visibility check while source was
still changing; it is not counted as a successful run. Both subsequent full final-state runs passed 68/68.

No push, main merge, branch rename, destructive library upgrade or original-row
replacement on migration was performed.

## Remaining scope

Phase 2 cycle/depth policy, Phases 3–4 recursive rendering, Phase 5 nested audio,
and Phase 6 compound editing/timeline UI remain separate work. Claude review
was requested via coordinator escalation and question `msg_8f92b43ae63a`;
the same question was resumed rather than duplicated, but no response arrived.
Implementation is committed for coordinator review; **Claude review is requested,
not completed**, and no approval or main-integration claim is made. Following the
instruction to continue without a monitoring response, the implementation uses
the approved conservative policies and leaves originals and recovery data intact.
