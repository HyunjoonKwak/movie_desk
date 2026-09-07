# B′5 Phase 5 — sequence audio

## Stereo boundary and project output

A sequence is one stereo source in its containing track. Its child timeline
applies local track gain, pan, mute and solo, and each clip's effects and volume
automation, then sums stereo without clipping. The sequence applies its own time
mapping, effects and volume automation to that mix. Repeat inside out for deeper
nesting. Parent track controls always control the completed child signal.

**This supersedes the Phase 0 scoped-bus proposal** in
[the earlier routing decision](2026-09-07-nested-sequence-audio-routing.md).
On 2026-09-08, during Phase 5 review, the coordinator made the product decision to use project bus/master processing only
at the containing **root** track. Child bus assignments are retained as data but
are not processed inside a compound. A shared bus fader therefore attenuates
flat and nested material by the same amount: −6 dB means ×0.501187, not
×0.251189 when both child and parent name the same bus. Child tracks use only
local gain/pan/mute/solo. A child-only bus mute does not mute the compound; its
parent track/bus does. Root endpoint ducking, limiting and encoder normalization
remain once at output, with the root track's voice/music category.

The original Phase 0 text explicitly required scoped bus multiplication, which
motivated the initial implementation. This is a deliberate product decision
change, not an accidental bypass. It avoids nesting-dependent project-fader
sensitivity without adding per-timeline bus catalogs or new storage fields.

`buildAudioSequencePlan` is the shared pure, instance-scoped plan. It resolves
local solo, ordered track routes, and child boundaries. Each repeated reference
gets independent stream state. Export and nested preview use the same PCM
evaluator; preview sends its folded source to the existing parent Web Audio
graph with a unity root route, so parent gain/pan/bus/master are not doubled.
Child edits invalidate scheduled PCM; parent graph edits retain existing live
smoothing. The stopped meter follows the same plan and time mapping, retaining
its existing phase-blind, loudest-contributor envelope estimate.

## Time, pitch and bounded streaming

The source time is exactly the Phase 4 expression:

```ts
clip.trimIn + sourceOffsetForRamp(clip, parentMs - clip.start)
```

Sequence PCM follows that same left-endpoint 10 ms integration grid. It caches
the integral as samples advance, avoiding repeated integration from clip start.
Fractional offsets and single-key speed tracks follow the helper's semantics.
For speed 1 the boundary is equivalent to offsetting child placement by
`parent.start - parent.trimIn` and clipping to the parent's visible interval.
For ramps, retaining the boundary rather than flattening placement is necessary
for correct source time and envelopes. Internal source ranges use integer PCM
indices to avoid millisecond/sample round-trip allocation errors.

The coordinator explicitly chose **sequence varispeed only in Phase 5**.
`MediaClip.preservePitch` remains opt-in and unchanged. A child with preservation
is rendered through B′2 first; parent varispeed then resamples the completed
stereo mix. A 440 Hz child at 2× with preservation, inside a 2× parent, produces
880 Hz, not 440 Hz or 1760 Hz. The transforms are applied in order; multiplying
rates into the leaf would invalidate preservation and local effects/automation.

Phase 6 can introduce a sequence `preservePitch` field together with its UI,
Zod and CRDT support. When opted in, apply B′2 **after child stereo mixdown** and
before parent clip effects/envelope/track routing, with a separate continuation
for each sequence instance. No speculative persistent field is added now.

Child PCM is streamed in one-second chunks and retained only across the source
window needed by the current parent output chunk, plus overlapping chunks and
one-sample interpolation guards. A forward child generator survives parent
chunk boundaries, preserving B′2 checkpoints. Backwards source windows restart
that child stream; reverse varispeed uses the same picture mapping. Memory is
bounded by active instance source windows and depth, not the whole timeline;
large speed factors and simultaneous instances still increase working memory.
Each mixer retains the existing two-asset decode LRU, so nesting can retain
more total decoded assets than a single flat mixer. This is an explicit cost,
not a claim of a project-wide two-asset memory limit.

## Invalid graphs and evidence

`analyzeSequenceGraph`, ancestry checks and `MAX_SEQUENCE_DEPTH` match Phase 4:
missing targets, self-reference, cycles and over-depth subtrees contribute
silence. The root counts as one of eight levels. The graph analysis is iterative
and accepted recursive evaluation is depth bounded. Disabled edges contribute
nothing. Child limiting is forbidden: loud child PCM can become quiet again
through its parent volume before the one root limiter.

[Evaluation and reproducible checks](../evaluations/2026-09-08-b5-phase5-report.md)
cover sample-wise flat equivalence, timestamps 650/845, fractional and reverse
mapping, repeated instances, eight valid levels, local solo, bus sensitivity,
master once, pitch transform order, preview graph routing and bounded failures.

## Meter routing ownership and follow-up

The existing strip estimator owns separate track, bus and master levels. Its
source query must stop before root routing, while nested track controls remain
inside that source. Applying the complete root route in that query doubles
routing when the strip then calculates its own levels. The shared plan therefore
supports a pre-root source query; the normal mixer still evaluates complete
routes. Stereo source peaks must remain stereo until the root pan matrix, because
collapsing a child pan to one scalar before a different parent pan loses the
ordered matrix result. A constant equal-channel fixture can compare estimated
master peaks against rendered PCM exactly apart from Float32 rounding.

This does not make waveform envelopes a substitute for measured PCM. The stopped
meter has no phase, frequency or full audio-effects information and retains the
loudest-contributor approximation. Playback uses actual worklet measurements
when available. General phase-cancelling sources and effects can therefore differ
from the fallback estimate by design. Follow-up: return named track/bus/master
stage peaks from one plan evaluator so strip estimation does not repeatedly
rebuild a per-track plan or own a second traversal of root routing.

Stale root duration is not solely a synthetic fixture possibility: legacy
hydration and `syncRootTimeline` preserve the provided duration; core model tests
explicitly assert no duration recomputation on load. Edit and CRDT paths do
recompute it. Root fallback metering continues to use clip intervals when that
metadata lags; child sequence evaluation remains bounded by its timeline source
extent. Follow-up: audit/reconcile stale duration at import boundaries without
changing persisted project meaning or truncating clips.
