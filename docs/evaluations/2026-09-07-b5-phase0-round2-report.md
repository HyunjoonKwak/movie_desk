# B′5 Phase 0 round 2 — review corrections

## Required findings

1. `toLegacyProject` checks collection cardinality, then normalizes the root alias itself with `syncRootTimeline`. Same-ID object drift now saves the latest edit; true identity corruption and nested writes still fail. Core serialization and library save/reload regressions verify self-healing and no new wire keys.
2. `replaceTrack` returns `{ project, timelineId }`; `recompute` consumes that target when composed. The child regression now calls `recompute(replaced)` without an explicit timeline and verifies child duration 2000, unchanged root identity, and unchanged source child duration 99.
3. Work order and original report explicitly state that all 18 recompute and both replaceTrack production calls still use root defaults. Only target-selection signatures are prepared; migration belongs to Phase 1.
4. CRDT catch documents that Phase 1 must rethrow typed nested validation/hydration failures before the null-as-missing path can overwrite a stored document. This remains unreachable with the Phase 0 v1 candidate.

The ProjectMenu autosave subscription is extracted to `library-autosave.ts` so both debounce and cleanup flushes share error handling and can be tested without a browser mock. Each failure produces an actionable toast and an error save badge; independent Yjs saved/saving events cannot erase the library failure. A later successful edit clears the failure. Tests exercise both flush paths and retry.

## Optional findings

- Root-ID stability comment now explicitly requires an unchanged project ID.
- Removed the audio-recovery `as Project` cast by retaining the codec parse return type at the adapter input. The two export/download assertions remain the narrow compatibility bridge to the unchanged legacy codec signature; removing them properly requires changing that protected codec's public input type, rather than moving or disguising the assertions.
- Frame allocation alternative reviewed: compositor reads playhead from the supplied project for visibility, text animation and transitions, even with a playhead getter. Safely eliminating snapshots requires a dedicated evaluation-time argument or a read-only view type through those queries; weakening alias consistency or mutating a shared project would undermine this batch. No hot-loop behavior changed; this optimization is deferred.

## Scope

No nested feature, schema opening, routing behavior change, merge, tag or push. The v1 codec remains untouched by this branch; CRDT stays version 2. i18n changes are two new keys appended with four-space indentation to each language, explicitly approved by the coordinator; existing lines are unchanged and no formatter ran on those files.

## Integration and validation

Rebased onto main `4791476` (release cleanup included). The original Phase 0
commit is now `125333f`; review corrections are `17af10f`. Conflicts were limited
to the project-export test imports and the work-order append location: the new
version-error tests use the Phase 0 adapter, and both work-order entries survive.
Protected codec, E2E files, and docs/09 match main exactly.

The pre-rebase gate passed 9/9 (core 161, web 721, desktop 72, scripts 11 = 965;
Chromium 64/64), before the final append-only wording placement and badge color
correction. Its [summary](2026-09-07-b5-phase0-round2-prerebase-gate.md) is retained
as intermediate evidence, not the final integration gate. Raw log:
`/tmp/b5-phase0-round2-gate.log`.

Final rebased [gate](2026-09-07-b5-phase0-round2-gate.md): **9/9 PASS**.
Core **161**, web **721**, desktop **72**, scripts **11** = **965** unit tests;
Chromium **66/66 PASS**, retry 0, **186.5s**. Typecheck, lint, production build and
i18n parity pass; OSV **167** production packages with zero known vulnerabilities.
Both gate runs checked 32119 with lsof before use (no listener) and found no
competing gate process. Build emitted only the existing MediaPipe dynamic
import warning. Final raw log: `/tmp/b5-phase0-round2-rebased-gate.log`.

Remaining work: integration review and Phase 1–7 implementation. If main moves
again before integration, rebase and revalidate the resulting tree; no merge or
push was performed by this worker.
