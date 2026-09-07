# B′5 Phase 0 round 3 — final review corrections

Branch: `codex/b5-phase0`; starting commit: `8707e86`.

## Item results

1. **Required: nested read failures — fixed.** Core exports `NestedTimelineError`; the legacy hydration guard throws it, and the CRDT read catch rethrows it while ordinary malformed v1 values still return null. A unit regression routes the real core guard through the parser boundary, verifies the typed throw, and checks the Yjs document is unchanged. This prepares the fail-closed path without opening the Phase 1 schema.
2. **Required: new-project save failure — fixed.** The upsert/active-pointer/success path has a try/catch using `project.saveFailed`. A Chromium regression injects `QuotaExceededError` into the library `projects` object-store write, checks visible error feedback, keeps the dialog open, rejects the success toast, and checks no uncaught page error.
3. **Optional: startup saved badge — fixed.** `setLibraryError(false)` is a no-op unless an actual library error is being cleared; an initial successful snapshot preserves idle/null. Recovery after failure still changes to saved.
4. **Optional: error icon/title — fixed.** The editor top bar uses `AlertTriangle` for errors and the translated label for the title.
5. **Optional: overlapping autosaves — fixed.** A monotonically increasing write number guards both completion branches, including cleanup and remount boundaries. Regressions cover late success after newer failure and late failure after newer success. This guards status publication; it does not introduce a storage transaction scheduler.
6. **Optional: honest text — fixed.** Korean and English feedback specifically report failure to save to the project library, without claiming all live Yjs edits were lost.
7. **Optional: ambiguous recompute — fixed.** Two overloads reject an explicit timeline alongside a composed track replacement. A `@ts-expect-error` compile check fixes this contract; child-target isolation remains covered.
8. **Optional: project-io casts — deferred.** The protected v1 codec still annotates its input as runtime `Project`. Removing the two adapter casts properly requires correcting that codec's legacy types; changing the protected file or merely moving the assertions would defeat this round's scope. Phase 1+7 should replace the adapter and codec atomically.

## Scope and validation

No SequenceClip, recursive rendering/audio feature, sequence UI, or persistence schema/version change. No call-site migration, main merge/push, other worktree edit, or user-media access. Protected codec, sampler and audio-mixer E2E files, and release checklist remain unchanged. Existing main changes are retained; this round did not rebase.

Targeted persistence tests: **12/12 PASS**. Final full `pnpm gate`: **9/9 PASS**; core **161**, web **725**, desktop **72**, scripts **11** = **969** unit tests; Chromium **67/67 PASS**, no retries, **184.8s** E2E gate step. OSV checked **167** production packages with zero known vulnerabilities. Lint/typecheck/build passed; the existing MediaPipe dynamic-import warning remains. Port 32119 had no listener before each gate attempt or after completion, and no competing gate process was running (lsof emitted an unrelated TimeMachine mount warning). An initial gate stopped at the constant-condition lint check in the new compile-only assertion; the assertion was rewritten as an uncalled closure before the final full run.

Raw final gate log: `/tmp/b5-phase0-round3-gate.log`.
