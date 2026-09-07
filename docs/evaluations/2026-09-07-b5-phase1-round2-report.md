# B′5 Phase 1 + 7 — review round 2

Review baseline: `1481e25`. Same worktree and branch; the prior rebase and dogfood
run sheet remain in history. One atomic follow-up commit contains the fixes,
regressions, benchmark and updated decisions/work order.

## Required review items

1. **Delete/move merge recovery:** schemas 2 and 3 read reachable ordered entries
   and ignore unreferenced map values. Missing/mismatched ordered entities,
   duplicate clip ownership and invalid required metadata still fail. Regression
   tests use independent Y.Doc replicas: tab A deletes map/order entries, tab B
   resets the same clip with a moved start, updates merge, then open/edit/reopen
   succeeds and the next write removes the orphan. Migration retains isolated
   staging and source-byte preservation on real validation failures.
2. **Flush safety:** store-listener writes use try/catch. Invalid duration=0,
   start=NaN, empty clip ID, and mismatched root ID produce save errors without
   throwing through setState; original CRDT bytes remain unchanged and a valid
   edit resumes persistence. Pending acknowledgements cannot clear an invalid
   edit error. Storage aborts also keep retry eligibility, using a complete
   checkpoint to cover any missing delta.
3. **Bounded, disposable backup:** embedded update limit is **1 MiB**. Larger
   migrations retain legacy roots temporarily and omit the extra inline backup.
   The checked IndexedDB update writer acknowledges transaction completion,
   reports abort/quota failures, and removes backup/legacy roots only after v3
   commits. Cleanup compacts the physical update log atomically, merging other
   tabs' committed updates in the same transaction. Failed cleanup retains the
   prior disk state and retries; pending backups also retry after reopening.
   Tests verify physical byte reduction, disk reopen, concurrent-tab retention,
   asynchronous aborts, synchronous transaction errors and synchronous add errors.
4. **Candidate test:** production candidate fields are captured in the spy and
   asserted after `toThrow`. Production exception wrapping can no longer swallow
   the assertions that protect `timelines` and `rootTimelineId`.

## Additional review items

- Invalid audio on inactive child tracks now triggers the recovery notification.
- A missing active library row recovered from CRDT is inserted without waiting
  for an edit. The same-transaction existence check preserves any existing row,
  including its exact original v1 JSON. Ordinary v1 library/snapshot reads and
  preview maintenance remain read-only.
- Malformed project field errors are concise sentences instead of Zod dumps.
- Root JSON alias duplication remains for version-2 importer/root-writer
  compatibility; the decision document records the storage tradeoff explicitly.
- Removed the redundant whole-project JSON clone before CRDT writes. Per-entity
  cloning and full strict validation remain. Removed the unreachable legacy clip
  branch and reused unique media/collection ID lists.
- No new `.catch()` chain; live restoration now uses async try/catch.

## Paired A5-scale write measurement

Reproduce with:

```sh
node apps/web/scripts/bench-nested-persistence.mjs output.json
```

The script bundles the `1481e25` writer from Git and the current writer, alternating
order across six Chromium rounds. Each has 10 warmups + 50 measured edits:
**1,000 assets, 1,000 clips, 300 measured edits per variant**, JSON **428,840 B**.
This measures synchronous validated Yjs writes, not import, rendering, IndexedDB
commit latency, or the full end-to-end library benchmark.

| Writer | p50 | p95 |
| --- | ---: | ---: |
| `1481e25` | 4.70 ms | 5.20 ms |
| Round 2 | 3.90 ms | 4.60 ms |

Median improved approximately **17%**, p95 approximately **12%**; no write-cost
regression in this fixture. [Raw measurement](2026-09-07-b5-phase1-round2-benchmark.json).

## Validation

Final `pnpm gate`: **9/9 PASS**, core **162**, web **770**, desktop **72**,
scripts **11** = **1,015 tests** (persistence **150**). Final-source E2E run 1:
**68/68 PASS, 2.7m** as part of the gate; independent run 2: **68/68 PASS, 2.6m**.
Production source was unchanged throughout both runs.
[Both full E2E logs](2026-09-07-b5-phase1-round2-e2e.txt).
Port 32119 was checked with `lsof -nP -iTCP:32119 -sTCP:LISTEN` before each run;
no listener was present (lsof reported an unrelated inaccessible Time Machine mount).
[Final gate evidence](2026-09-07-b5-phase1-round2-gate.md).
A preliminary gate passed 9/9 and E2E 68/68, but a final request-error guard and
legacy recovery follow-up landed during that run, so it is not counted toward
the two final-state runs. The final gate is rerun in full.

## Remaining scope and limitations

Root alias storage duplication is intentional for wire compatibility. The checked
writer integrates through y-indexeddb's declared internal listener/counter fields;
revalidate that adapter on dependency upgrades. Truly missing ordered data or
invalid required metadata still block hydration and preserve originals. Recursive
rendering, nested audio traversal and compound editing remain later B′5 phases.
