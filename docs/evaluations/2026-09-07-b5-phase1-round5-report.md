# B′5 Phase 1 + 7 — review round 5

Baseline `40e1c6d`, same branch/worktree. No push, main integration, branch rename,
dependency changes, or later-phase implementation.

## Required items

1. **Cross-track duplicate clips:** schema-3 reads keep the first reference in
   recovered track order and drop subsequent references with `referencesRemoved`.
   The next project write heals those arrays. Schema-2 reads and the current JSON
   parser follow the same first-track rule. Mismatched IDs and malformed values
   remain errors. `reconcileSequence` is unchanged.
2. **Actual writer regressions:** new tests seed and edit independent Yjs replicas
   through `createProjectCrdt.write` for cross-track move versus forward reorder,
   cross-track move versus a different target track, and deletion versus forward
   reorder (matrix cell 9). Tests prove the conflicting arrays before hydration,
   verify identical placement on both replicas, and save/reopen without recovery.
3. **Unplaced clip backup and counts:** validated optional `preservedClips` project
   JSON carries `{ timelineId, clip }`, survives project edits/normalization and
   JSON export/import, and seeds the correct scoped entries in a fresh Yjs doc.
   This covers map-only clips and clips under deleted track metadata. Legacy
   migration includes the payload on its initial returned project as well.
   Load and JSON-export notices give the count and explain exclusion from the
   visible timeline and rendered movie. A live IndexedDB test checks the count
   and one-notice-per-session behavior.

## Optional review items

- Changed the contents notice to “may have been partially or fully removed” and
  report it for recovered timeline/track metadata, because CRDT state does not
  contain a trustworthy previous content count. This can include originally
  empty items but no longer asserts that deletion certainly happened.
- Hoisted timeline/track order arrays to Sets outside the nested loops.
- Remeasured write cost instead of adding a potentially incorrect map-size guard:
  the existing orphan-preservation scan remains, with no measured regression.
- Existing restored-order notice already names append-to-end and stack bottom.
- Deferred validation/recovery for dangling nested timeline targets, and the
  redundant media/collection validation branch: neither is needed for the two
  mandatory fixes, and target deletion needs an explicit content-loss policy.

## A5 paired write benchmark

`node apps/web/scripts/bench-nested-persistence.mjs output.json [baselineHash]`
now loads baseline project-crdt, timeline-crdt and project-export modules together,
so the comparison includes the preservation scan and parser costs, not just a
single historical writer combined with current dependencies.

Chromium synchronous validated Yjs writes; 1,000 assets and 1,000 clips, 300 edits
per variant across six alternating rounds (10 warmups + 50 samples each).
JSON size 428,840 bytes. Both baseline `40e1c6d` and round 5: **p50 4.0ms,
p95 4.5ms**. This is not IndexedDB commit latency or rendering performance.
[Raw measurement](2026-09-07-b5-phase1-round5-benchmark.json).

## Remaining product limitation

This round implements the requested minimum of durable JSON backup and visible
counts. Unplaced clips still have no placement/discard UI and cannot appear in a
rendered movie until placed; their count notice can recur in a new session.
Their known timeline ownership and full clip payload are retained for recovery.

## Validation

Final `pnpm gate`: **9/9 PASS**, core **162**, web **798**, desktop **72**,
scripts **11** = **1,043 tests** (persistence **178**). Gate E2E: **68/68 PASS,
2.6m**, browser step **159.5s**. Independent second full E2E: **68/68 PASS, 2.7m**.
No production/test source changed between the runs. Before both runs, lsof
confirmed port 32119 had no listener (only the unrelated Time Machine mount
warning); it was free after completion. OSV checked **167** production packages
with no known vulnerabilities. `git diff --check` passed.
[Gate summary](2026-09-07-b5-phase1-round5-gate.md) ·
[Both E2E logs](2026-09-07-b5-phase1-round5-e2e.txt).
A preliminary gate passed lint,
types and all unit tests but failed build because an added import preceded the
client directive; that ordering was corrected before the final full rerun.
