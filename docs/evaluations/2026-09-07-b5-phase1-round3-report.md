# B′5 Phase 1 + 7 — review round 3

Baseline: `4340422`; same worktree and branch. No branch rename, main integration,
push, schema bulk rewrite, dependency changes, or later-phase implementation.

## Required review items

1. **Orphan timelines/tracks/media:** entity maps determine existence, while
   arrays determine order. Append map-only entities by sorted ID to the read
   result, including collections and schema-2 tracks/media. The next edit writes
   the recovered order instead of deleting survivors. Tests cover independent
   replicas deleting versus renaming each entity, retained child contents in the
   metadata-level merge, and the full project writer deleting a referenced child
   versus another writer renaming it. The latter preserves the surviving child
   metadata and root reference; entities both replicas have deleted cannot be
   resurrected from absent map values.
2. **Missing ordered clips:** schemas 2 and 3 now omit order references whose
   clip map entries were deleted. Tests actually reorder `[A,B,D,C]` into
   `[A,B,C,D]` through `reconcileSequence` in one replica while deleting C in
   another, proving the merged order contains C while its map entry is absent.
   Both versions open, edit, save and reopen without a permanent hydration block.
3. **Recovery visibility and escape:** both repairs set `takeRecovery`, consumed
   by live-doc with one notice per open session. ID mismatches, missing ordered
   non-clip metadata and invalid required fields still fail with an action to
   open a new recovery copy from a validated library row. The damaged document
   and original row remain intact; the copy receives a new ID and can save.
   Missing/corrupt library rows show a concrete message to open another project
   or import a backup, rather than silently replacing damaged data.
4. **Actual provider verification:** a real `IndexeddbPersistence` integration
   test installs the checked writer before hydration, proves exactly one update
   is stored per edit, crosses the provider's native debounce threshold, verifies
   the physical log has one entry after 500 edits and no native timer remains,
   destroys the provider and proves later document edits start no transaction,
   then hydrates all committed data with another real provider.
5. **Compaction failure backoff:** `fail()` resets both `writes` and
   `compactNext`. Failed writes still require a full-state checkpoint, but the
   next ordinary edit does not repeat a full log merge. A regression injects a
   quota exception at the 500th write, asserts one `getAll` attempt across the
   failure and retry, then reopens both the failed edit and the subsequent edit.

## Additional items

- Idle IDB failures retry a complete checkpoint after 2 seconds, doubling to a
  30-second maximum. Success/disposal cancels retry; invalid edit validation does
  not schedule it. A real live-doc/provider quota test makes no further edit and
  verifies durable recovery after the timer. Closing before a successful retry
  can still lose pending data; no beforeunload prompt was added.
- `live-doc-indexeddb.test.ts` uses the real writer and real provider together;
  only storage failure and toast observation are injected. It verifies recovered
  child persistence and one notice, idle retry, and the recovery action.
- Audio recovery's index correspondence now explicitly documents that parsing
  preserves timeline and track array order.
- Ordinary writes still validate before the transaction and do not stage a full
  isolated document on every edit. Migration retains staging. Unexpected future
  exceptions during a write transaction remain an architectural limitation;
  adding a full clone for every drag would need a separate performance review.
- Retry may checkpoint after a write as well as the write's delta. Recovered
  missing library rows still use the reconstructed project's current `updatedAt`.
  Those optional write-amplification/ordering refinements are deferred.

## New regression inventory

- `merge-recovery.test.ts`: timeline, track, media and collection delete/rename
  merges (4); actual clip reorder/delete with schemas 2 and 3 (2); full project
  child deletion versus rename with retained sequence reference (1).
- `checked-indexeddb.test.ts`: real provider lifecycle/compaction/hydration (1);
  failed compaction backoff with durable checkpoint (1).
- `live-doc-indexeddb.test.ts`: notice plus real durable recovered-child save (1);
  idle real quota retry (1); library recovery copy and original preservation (1).
- Replaced the old expectation that a missing ordered legacy clip must throw
  with the real schema-2 merge recovery regression; other migration corruption
  and staging-failure preservation checks remain. Two additional schema-2/3
  cases prove malformed null clip values still fail and preserve source bytes;
  only absent map entries take the deleted-clip recovery branch.

## Validation

Final `pnpm gate`: **9/9 PASS**, core **162**, web **783**, desktop **72**,
scripts **11** = **1,028 tests** (persistence **163**). Final-source E2E run 1
inside the gate: **68/68 PASS, 2.7m**; independent run 2: **68/68 PASS, 2.7m**.
Production source was unchanged throughout both final runs. Before every run,
`lsof -nP -iTCP:32119 -sTCP:LISTEN` found no listener; its only warning concerned
an unrelated inaccessible Time Machine mount.
[Both final E2E logs](2026-09-07-b5-phase1-round3-e2e.txt).
[Gate evidence](2026-09-07-b5-phase1-round3-gate.md).
A preliminary gate passed 9/9 with E2E 68/68 before the final malformed-clip
value distinction; it is not counted toward final-source validation.
