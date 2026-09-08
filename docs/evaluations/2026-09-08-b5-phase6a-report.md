# B′5 Phase 6A — timeline editing and tabs

Base: `d41062d` (`origin/main`, Phase 5). Branch:
`HyunjoonKwak/codex-b5-phase6`; initial diff against origin/main was empty.
The coordinator explicitly narrowed this dispatch to items 24–26. Phase 6B owns
compound creation **and unpack**, plus preserved-clip recovery; Phase 6C owns
sequence pitch opt-in, migration and DSP. No pitch field/schema version changed.

## Product and architecture decisions

- Single-timeline projects return the existing TimelinePanel directly, with no
  tab strip or wrapper. Nested projects show the root and all existing child
  timelines. Arrow keys wrap, Home/End navigate, the selected tab is the sole
  tab stop, and the strip scrolls horizontally on narrow windows.
- Timelines currently have no persisted name. The root gets a translated main
  timeline label and children a translated unnamed label plus catalog ordinal.
  This avoids introducing a storage field before 6B decides compound naming.
- Active timeline ID lives only in timeline-ui-store. Switching stops playback,
  commits a pending gesture, and clears clip selection and the in/out range.
  Editing and history retain the original project root. Invalid/stale active IDs
  read the root; loading a document resets selection of the timeline to root.
- Timeline components, keyboard actions, inspector, mixer, subtitles and preview
  read the editor view. Discrete edits and continuous drag/precision edits route
  through an adapter; completed history snapshots are canonical documents.
  Project exports, snapshots, autosave and native snapshot commands read the
  canonical store. Autoedit's pre-edit snapshot explicitly uses that store.
  Existing direct AI/subtitle project writes now use the history-aware adapter.
- Previewing a child treats that timeline as the standalone preview root. Parent
  preview and final project export still use the canonical containing root.

## Structural protection against saving an editor view

The coordinator identified that replacing rootTimelineId in a temporary view is
self-consistent enough to pass ordinary document validation. A core symbol marks
views with their original root, and an enumerable toJSON trap rejects accidental
serialization. Both survive ordinary object spreading in edit primitives. The
materialization boundary checks the original-root provenance, restores its alias,
and only then removes the marker/trap. Persistence parsers, project/timeline CRDT
write boundaries, history recording and project loading reject marked values.

Tests deliberately leak the edit callback input, copy a view with object spread,
pass views to current/stored export preparation and CRDT, and record them as
before/after history. Each is rejected; failed CRDT writes leave the encoded
state unchanged. Materialized edits save and round-trip with the original root.
This is an accidental-leak guard, not a security boundary against code deliberately
stripping all provenance and constructing a different document by hand.

## Editing gate audit

| Surface | Decision |
| --- | --- |
| split / three-point tail trimming | `hasSourceTrim` includes media and sequence source offsets. |
| roll / slide neighbour offset and lower-bound clamp | Same shared predicate; sequence neighbours retain the source window. |
| core slip / store slip / precision source trim | Include sequences; store resolves child duration instead of a media asset. |
| inspector source controls | Sequence source trim/slip and speed controls are available; media-only controls stay gated. |
| generic move, duration trims, ripple, grouping, transforms, keyframes and effects | Already operate on Clip base data; no media gate to replace. Existing timing conventions are retained. |
| freeze and spatial fit | Stay media-only: SequenceClip has no freeze/fit contract in the renderer. |
| detach audio | Stay media-only: it creates an asset-backed MediaClip and reads assetId, rather than a child mixdown reference. |
| waveform, thumbnail, missing-asset inspection, AI decode, multicam switching | Stay media-only because they need an actual media asset/decoder or replace assetId. |
| media pitch preservation, volume inspector | Stay media-only; sequence pitch UI/storage/DSP belongs to 6C, and the current sequence model has no volume field. |

Source-offset arithmetic keeps existing media edit conventions. This change does
not redesign speed-ramp/keyframe rebasing or reverse-source trim semantics.

## Evidence

- Core sequence-editing tests: split/insert continuity, overwrite surviving tails,
  roll/slide offsets and lower-bound clamp, bounded slip and root alias coherence.
- Store active-timeline tests: child split + one undo/redo, tab independence,
  drag/precision/track editing, canonical history, preserved view coordinates on
  gesture cancellation, playback/selection/range reset, bounded sequence trim.
- Persistence editor-view-guard tests: leaked/captured/spread views are rejected;
  normal edits remain serializable and CRDT-compatible.
- `timeline-tabs.spec.ts`: 5 E2E tests passed in both languages via actual project
  JSON import, child deletion and changed parent canvas, undo/redo tab stability,
  keyboard navigation, unchanged single-timeline geometry/no extra panel wrapper,
  and 768px Korean layout with no document horizontal overflow.
- Existing assertions were not edited. Translation files received only appended
  entries with four-space indentation; no formatter was run.

## Final release gate

`pnpm gate --report docs/evaluations/2026-09-08-b5-phase6a-gate.md`: **9/9 PASS**.
Unit tests: **1,094 passed** (core 175, web 836, desktop 72, scripts 11), with
one pre-existing web benchmark skipped. Chromium: **77/77 PASS**, including the
five new timeline journeys; browser phase took 194.2 seconds. Production build,
typecheck, frozen install, version policy, lint and OSV audit all passed.

The [initial gate](2026-09-08-b5-phase6a-gate-initial.md) stopped at production
build because an import preceded the store's use-client directive. Moving the
import below that directive fixed the build; the complete gate was then rerun,
not merely the failed step. Existing assertions remained untouched.

The [final gate](2026-09-08-b5-phase6a-gate.md) and
[source-integrity receipt](2026-09-08-b5-phase6a-source-integrity.json) record the
result: **661 source/config fingerprints unchanged** across the final gate,
excluding the known generated next-env.d.ts file. That file has no final diff
and is excluded from staging. Port 32119 was free after the test server exited.
No merge, push or tag was performed.

6A is ready for coordinator review. Compound naming/creation/unpack and preserved
clip restoration/disposal remain in 6B; sequence pitch migration/CRDT/DSP remains
in 6C. The current E2E fixture is a persisted shape-containing nested document,
not a real-media compound-creation journey (creation is intentionally unavailable
until 6B). Single-timeline evidence asserts absent tab/panel wrappers and stable
geometry through editing; it is not a cross-build pixel-diff benchmark.
