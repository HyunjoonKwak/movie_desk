# B′5 nested sequence audio routing — 2026-09-07

Status: historical Phase 0 prerequisite. Phase 5 implementation and its updated
bus policy are recorded in [the Phase 5 decision](2026-09-08-sequence-audio.md).
The scoped child-bus multiplication proposed below is superseded: only the root
containing track applies the project bus and master; child tracks apply local
controls. Other boundary/automation/solo principles remain applicable.

## Sequence boundary

A referenced sequence produces one stereo mix, before the project master. Its
tracks retain their gain, pan, mute/solo and optional bus gain/mute inside that
mix. Internal tracks are not promoted into the parent's track/bus graph. The
SequenceClip's resulting stereo signal enters its containing parent track, then
that track's optional bus. Repeat at each boundary; apply Project.audio.master
exactly once at the root output. No per-timeline master or bus model is added in
Phase 0: Project.audio remains the shared bus-definition/settings catalog.
A bus assignment is evaluated in the timeline where its track lives; internal
and parent assignments to the same bus therefore apply that gain at both stages.
They are distinct scoped processing instances, not a bus feedback connection.
Missing bus IDs retain the existing direct-output/unity-bus fallback.

This extends the one-level bus contract without adding sends or bus-to-bus
edges. Evidence: core audio-routing/routing.ts `resolveTrackRoute` resolves one
bus and `routeStereo` multiplies trackGain * busGain * masterGain; the existing
B′3 decision specifies source/effects → clip automation → track → optional bus
→ master. In Phase 5 an internal route must exclude masterGain explicitly;
recursively calling the current resolver/routeStereo unchanged would multiply
project master once per depth and is forbidden.

## Automation, solo and time

For each source, evaluate effects and its volume automation in its local clip
time; keyframes replace base volume (they do not multiply it). Mix internal
tracks after their local routing. Evaluate the SequenceClip volume envelope in
its own parent clip-local time, again replacing its base volume, and multiply
the completed child mix by that envelope before parent track gain/pan/routing.
Thus child envelope × child routing → sum → sequence envelope × parent routing;
automation at different levels multiplies, while a level's base volume is used
only when it has no active volume keyframes. Preserve each pan in order: child
and parent stereo crossfeed matrices cannot in general be collapsed to one pan.
Source mapping must share trim/speed/ramp conversion and clipping of the parent
instance's visible interval; separate references to one child are separate mixes.
Evidence: preview/audio-engine.ts `scheduleClip` volume curve replaces
`clip.volume ?? 1`; export/audio-mixer.ts applies volume before `routeStereo`;
core/audio-routing/routing.ts documents this replacement contract explicitly.

Solo is local to a timeline. Internal solo selects internal tracks only; parent
solo selects parent tracks only. Both gates must pass along the ancestry path.
A child solo cannot unmute or bypass a non-solo parent track, and soloing the
parent does not disable child solo/mute. Explicit track mute and bus mute always
win over solo. The current `resolveTrackRoute` and `editMixer` are root-only:
solo scans `project.timeline.tracks`, track edits and bus-reference cleanup visit
only those tracks. Phase 0 preserves this behavior. Phase 5 must accept an
explicit timeline scope for solo/route resolution, and bus deletion must clear
references in every persisted timeline atomically when that model is enabled.

## Shared preview/export contract

export/audio-mixer.ts `ProjectAudioMixer` constructor immediately flatMaps root
tracks into PreparedClip records and captures a TrackRoute for each. Offsetting
child start times in Phase 5 alone is insufficient: it loses sequence boundaries,
parent envelopes and scoped solo. preview/audio-engine.ts `scheduleRange` also
filters root solo before scheduling; mixer/audio-graph.ts `update` creates track
→ bus → master nodes keyed only by track/bus ID, with one master destination.

Phase 5 must share a pure, instance-scoped audio evaluation plan in core: timeline
scope/ancestry, time mapping, audible gates, envelope evaluation, ordered pan and
gain stages, bus resolution and a single root-master stage. Preview translates
that plan into instance-qualified Web Audio nodes; export evaluates it into PCM.
Existing `stereoPanMatrix`, explicit mono-to-stereo upmix and gain clamping remain
the common DSP contract. Test identical nested fixtures with repeated references,
nonzero master/bus gains, two pans, keyframes, local solos and dangling bus IDs.
Current preview edit smoothing (10 ms) and export-only ducking/limiter/LUFS remain
existing endpoint policies, not evidence of a different nested routing rule.
Root export ducking uses the containing root track's existing audio/music versus
other/voice category for the folded stream; never duck/limit/normalize each child.
Preview/export parity means the same pre-endpoint signal for fixed parameters.
Cycle/depth guards must be shared with the later sequence graph work.

## Phase 0 storage boundary

Phase 0 adds in-memory timeline identity, a timeline collection and the root ID;
legacy `timeline` remains the root alias. Existing editing behavior is unchanged.
The new `persistence/project-io.ts` adapter is the runtime entrypoint for project
parse/export/download and recovery metadata; `project-export.ts` stays the unchanged
v1 codec (its legacy Project annotation is isolated by the adapter). Library and
snapshot writers project the model to v1 fields; CRDT writes check support before
mutating Yjs. No zod, CRDT schema version or document layout changes are made.
Persistence remains version 1 and CRDT schema 2; runtime collections are derived
on load and must not be written to the single-timeline wire format. Saving an
actual multi-timeline runtime project must fail rather than discard its children.
Phase 1 and Phase 7 must introduce zod + CRDT support in the same commit.

**Never use `.catch()` on `timelines`, `rootTimelineId` or nested sequence fields.**
Malformed or unsupported nested data must fail explicitly; it is not recoverable
by silently dropping a block. Evidence: persistence/project-export.ts currently
recovers optional audio blocks with `.catch(undefined)`, while live-doc.ts
`applyFromDoc` immediately calls `projectCrdt.write(project)` after loadProject.
project-crdt.ts `read` reconstructs a candidate from known fields only. Reusing
audio recovery for nested data would permanently delete children during load.
The current permissive collections union is not precedent for sequence clips:
Phase 1 must keep unknown sequence kinds/version failures explicit and lossless.

## Code references (c072cd0 baseline)

- [`routing.ts:29–41, 44–78`](../../packages/core/src/audio-routing/routing.ts):
  root solo selection, one bus, master, stereo matrix and volume contract.
- [`edits.ts:20–36, 58–74`](../../packages/core/src/audio-routing/edits.ts):
  root track mutation and bus-delete reference cleanup.
- [`audio-mixer.ts:276–290, 388–413`](../../apps/web/src/export/audio-mixer.ts):
  eager PreparedClip routing and per-sample volume followed by stereo routing.
- [`audio-engine.ts:231–263, 416–442`](../../apps/web/src/preview/audio-engine.ts):
  root scheduling gate and volume node before track graph input.
- [`audio-graph.ts:128–163`](../../apps/web/src/mixer/audio-graph.ts):
  root track/bus node keys and final master connection.
- [`live-doc.ts:93–105`](../../apps/web/src/persistence/live-doc.ts) and
  [`project-crdt.ts:149–175`](../../apps/web/src/persistence/project-crdt.ts):
  load-time immediate rewrite and known-field candidate reconstruction.
