# B′5 Phase 1 + 7 — review round 4

Baseline `023fb74`, same branch/worktree. No push, main integration, branch rename,
dependency change, or later-phase implementation.

## Symmetric recovery matrix

| Entity | Map only | Order only |
| --- | --- | --- |
| Timeline | Append by ID; notify; actual cascade leaves empty tracks and emits contents-removed notice | Drop stale ID; notify; save/reopen succeeds |
| Track | Append by ID at stack bottom; notify; actual cascade leaves empty clips and emits contents-removed notice | Drop stale ID; notify; save/reopen succeeds |
| Media | Append by ID to library end; notify; save/reopen preserves renamed value | Drop stale ID; notify; actual drag/delete saves and reopens |
| Collection | Append by ID to end; notify; save/reopen preserves renamed value | Drop stale ID; notify; actual drag/delete saves and reopens |
| Clip | Preserve exact scoped map value across unrelated writes/reopen; notify that placement could not be restored | Drop stale reference; notify; actual reorder/delete saves and reopens |

All ten cells have regressions in `merge-recovery.test.ts`. Entity map-only tests
now drive the deleting replica with `createProjectCrdt(a).write(...)`, so content
cascade is observed rather than hidden by hand-written map deletion. Order-only
entity tests run full project writes on both replicas, prove the intermediate
missing-map/present-order state, and verify the next save heals order. Clip
map-only coverage uses actual deletion versus duration trimming, checks the exact
trimmed value after reopening, and retains the invisible clip without inventing
its owner. Existing schema-2/3 clip reorder tests cover the opposite direction.

`crdt-migration.test.ts` additionally preserves map-only legacy clips in v3 before
cleanup, recovers missing ordered legacy tracks/media, and asserts explicit
malformed-null clip error messages. Contradictory IDs remain errors. Recovery
reasons are cleared on failed reads so they cannot leak into a later clean read.

## User-visible behavior and limitations

Four English/Korean notices distinguish appended placement, deleted references,
unplaced clip preservation, and restored metadata whose contents were deleted.
The order notice explicitly says ID order, append-to-end, and stack bottom. Each
reason is shown once per open session. Full deletion versus concurrent rename
accepts the winning content cascade; it does not claim to restore child content.
Unplaced clips remain durable in the Yjs document, but are not visible on a track
or included in JSON exports; assigning placement or a recovery UI is future work.

Recovery copy names use a dedicated localized noun and a fresh `updatedAt`.
Idle persistence retries reschedule when the provider's database is temporarily
null instead of silently ending the chain.

The optional forced-cleanup-compaction retry change is deferred: this round keeps
the already-approved failed-compaction backoff policy. If migration cleanup's
forced compaction fails, the full checkpoint retry preserves durability but the
physical backup can remain until the next 500-edit compaction. A separate cleanup
retry schedule would need to preserve the no-full-merge-on-every-edit guarantee.

## Validation

`pnpm gate`: **9/9 PASS**, core **162**, web **791**, desktop **72**,
scripts **11** = **1,036 tests** (persistence **171**). Final-source E2E run 1
inside the gate: **68/68 PASS, 2.7m**; independent run 2: **68/68 PASS, 2.7m**.
No production/test source changed between runs. Before each run,
`lsof -nP -iTCP:32119 -sTCP:LISTEN` found no listener (only the unrelated
Time Machine mount warning). `git diff --check` passed.

[Gate evidence](2026-09-07-b5-phase1-round4-gate.md) ·
[Both E2E logs](2026-09-07-b5-phase1-round4-e2e.txt).
