# B′5 Phase 0 implementation report — 2026-09-07

Branch: `codex/b5-phase0`; fetched baseline and HEAD before work:
`c072cd0b4b45fc31ca6e013b3cac5175e1c0e914` (`origin/main`).

## Result

Prerequisite audio decision and Phase 0 only are implemented. No SequenceClip,
recursive renderer/audio feature, sequence UI, schema version bump, push or merge.

- [Audio decision](../decisions/2026-09-07-nested-sequence-audio-routing.md):
  child tracks retain local gain/pan/mute/solo/bus processing and fold to stereo;
  sequence automation then parent routing multiply that mix. Volume keyframes
  replace base volume at each level. Solo scopes intersect along ancestry;
  the project master is applied once at root. Shared future instance-scoped
  evaluation plan must drive preview and export; current audio behavior is unchanged.
- `Timeline.id`, `Project.timelines`, `rootTimelineId` and `findTimeline` are
  available. `timeline` is the root alias, published alongside collection changes.
  `recompute` and `replaceTrack` have target-selection signatures ready; all 18
  production recompute calls and both replaceTrack calls still use the root default.
  Call-site migration belongs to Phase 1; unrelated timelines retain their identity. Root direct writes in markers, view state,
  split, multicam, mixer, generated edits, subtitles, store and render snapshots
  use the same synchronization boundary. Commands normalize before recording undo.
- `project-io.ts` wraps the unchanged v1 codec. Project consumers now use that
  adapter for parse/export/download and audio recovery metadata. Library and
  snapshot JSON omit runtime fields; CRDT guards unsupported writes before mutation.
  Existing CRDT layout/version 2 and JSON version 1/zod are unchanged. Legacy root
  IDs derive deterministically from project ID; no child data is persisted in Phase 0.
- Unsupported nested JSON fields fail explicitly, and v1 writes of multiple
  timelines fail. The decision forbids `.catch()` on timelines/root/sequence data;
  Phase 1 and Phase 7 must open persistence together in one commit.

## Validation

[Full pnpm gate](2026-09-07-b5-phase0-gate.md): **9/9 PASS**.
Core **160**, web **718**, desktop **72**, scripts **11**: **961** unit tests.
Browser Chromium **64/64 PASS**. OSV: **167** production packages, zero known
vulnerabilities. Typecheck/lint/build pass. The build retains its existing
MediaPipe dynamic dependency warning. Port 32119 and other gate processes were
checked before starting; no competing gate was running.

New regression coverage verifies exact legacy JSON field preservation, runtime
root reference equality, stable default IDs after reload, CRDT read/immediate
rewrite equivalence, unsupported-write atomic rejection, library/snapshot shape,
child-target mutation isolation, transient precision cancellation, drag snapshots
and undo/redo. Existing audio routing/pitch/recovery tests pass through the adapter.

## Direct-access census and scope

The task's exact grep expression counts **247** occurrences: web **157**, core
**90** (baseline 239 = 157 + 82). It also matches `project.timelines` by prefix;
with word boundaries the actual singular expression counts **241** (157 + 84).
The compatibility read surface is retained rather than migrated wholesale; the
new invariant helpers account for the additional accesses.

Protected files `persistence/project-export.ts`, `e2e/webcodecs-sampler.spec.ts`,
`e2e/audio-mixer.spec.ts`, docs/09 and i18n files have no diff. A requested exception
for the codec file was not used: the adapter fulfills the task without changing it.
No other worktree, user drive or unrelated files were changed. Network use was
limited to the requested origin fetch and release gate tooling.

## Remaining work

Claude integration review and the separately scheduled Phase 1–7 batches remain.
The current model can describe multiple timelines for unit-level foundation tests,
but application editing/routing remains root-only and persistence refuses children.
The planned zod/CRDT atomic migration must replace the v1 adapter, add cycle/depth
guards and instance-aware audio/renderer behavior before nested features are enabled.
