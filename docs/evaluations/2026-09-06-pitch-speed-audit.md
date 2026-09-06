# B′2 pitch/speed audit — 2026-09-06

Baseline: 354cd43. Synthetic 48 kHz fixtures, no user media or external drives.
Chromium OfflineAudioContext exercises the actual AudioBufferSourceNode playbackRate
mechanism; the export reference reproduces the existing floor(sourceCursor) loop.
Zero-crossing estimates discard 100 ms at each window boundary.

| 440 Hz fixture | Preview measured Hz | Export measured Hz | Pitch error |
| --- | ---: | ---: | ---: |
| 0.5× | 219.737 | 219.737 | −50.06% |
| 2× | 878.750 | 878.750 | +99.72% |
| 0.5→2× over 2 s, first/last 0.5 s | 303.333 / 796.667 | same rate-dependent mapping | variable |

Nearest-neighbour resampling has no reconstruction or anti-alias filter. A 18 kHz
input at 2× folds to 12 kHz at 48 kHz output (36 kHz is above Nyquist).
Linear interpolation will reduce fractional-position imaging but is explicitly
**not an anti-alias filter**. Browser resampling quality is engine dependent.

## Candidate evaluation

| Approach | Quality | CPU | Implementation | License |
| --- | --- | --- | --- | --- |
| Own linked-channel WSOLA | Good tonal/speech continuity; transient duplication and flutter possible | Bounded local correlation, linear in duration | Small pure TS DSP plus worker/cache | Repository license; no new dependencies |
| Plain OLA | Phase discontinuity/comb filtering on voiced material | Lowest | Small | Repository license |
| Own phase vocoder | Stable harmonic pitch; transient smearing without phase locking | FFT per hop, higher | Substantially larger FFT/phase/transient machinery | Repository license |
| soundtouchjs | Mature speech/music time stretching | Suitable worker execution | Wrapper/integration | LGPL per task constraints; excluded without approval |

Decision: own WSOLA, see ../decisions/2026-09-06-pitch-preserving-speed.md.
Implementation measurements and reproducible fixture coverage are recorded below after validation.

## Baseline additional fixtures

Reproduce from repository root: `node scripts/pitch-export-benchmark.mjs --varispeed`
(using the already installed Playwright Chromium).

| Fixture at 2× | Preview | Export |
| --- | --- | --- |
| Speech-band burst, 64 deterministic random-phase tones 300–3387 Hz, source 200–400ms | RMS 0.316096; 439 positive crossings in 500ms output | RMS 0.316096; 439 crossings |
| 18kHz alias probe | 12kHz amplitude 1.000, RMS 0.707107 | 12kHz amplitude 1.000, RMS 0.707107 |

This Chromium backend also aliases the high-frequency probe at integer 2×;
we do not assume browser playbackRate is band-limited.

## B′2 implementation measurements

Local Chromium, 48kHz stereo 60s source, 2× to a 30s output:
worker DSP **116.59ms**, worker bootstrap/transfer/response **128.53ms**,
first AudioBufferSourceNode.start **179.94ms** after play request,
maximum measured new main-thread allocation/copy slice **0.29ms**.
Repeated with CPU profiler: DSP 119.97ms, first start 185.92ms, slice 0.27ms.
Playwright asserts DSP ≤2000ms, first start ≤500ms, pitch slices ≤16ms.
These are warm dev-server local measurements, not cross-device guarantees.

A cold native `new AudioContext()` still causes a pre-existing ~112ms main-thread
stall (CPU profile attributed 112.28ms to AudioEngine.getCtx). Overall page long
tasks reached 106–126ms; the new DSP stays in a worker and its copy slices remain
below 16ms. The global page therefore cannot be described as entirely free of
>16ms tasks. This existing browser-context startup cost is separate from WSOLA.

Core fixtures pass 0.5×/2× tonal pitch tolerance ±2%, exact requested sample
count, linked stereo anti-phase preservation, 0.5→2× ramp (source integral
2492.5ms over 2000ms), trims, silence, empty/short input and reverse safety.
Export fixture covers 700ms chunked ramp/trims and reverse linear fallback;
cache tests cover semantic keys, source revisions, byte LRU and invalidation;
persistence covers absent/false/true JSON/stored/CRDT round trips and one undo.

Preview retains up to **128MiB output PCM**; an in-flight job separately admits
at most 128MiB source and 128MiB output (temporary output→AudioBuffer copy can
briefly duplicate output). Jobs are serialized, preview admits one job, and
larger clips continue varispeed. Cache includes trim, duration, speed, ramp,
source revision and toggle; waveform edits invalidate by key and relink by asset.
Rendering never blocks first playback. Subsequent playback/refill uses cached
PCM. On worker failure preview remains varispeed; export reports failure.

## Existing export defect discovered during validation

A 1s timeline produces 30 VP9 frames (1.000000s) but 50 AAC packets (1.066667s),
confirmed by ffprobe. The first feature commit verifies video/PCM timeline
length; coordinator approved a separate `fix(export)` commit for AAC priming
and end padding, with onset/last-100ms regression checks. This is an existing
mux timing defect, not WSOLA output length drift.

Feature gate: **PASS**, all 9 steps; web unit 558, desktop 72, scripts 11, E2E 56.
Gate benchmark: DSP 119.89ms, first start 73.70ms, max pitch slice 0.315ms.

AAC correction: local 128kbps stereo calibration finds **2112 samples** of delay.
Reserve the muxer's existing edit list, retain all encoded packets, and expose
only requested samples after 4096-sample preroll plus measured priming. ffprobe
confirmed **VP9 1.000000s / AAC 1.000000s / container 1.000000s** (30 video frames,
58 AAC packets retained). No packet or end audio is truncated. New mux unit test
compares every packet byte before and after presentation editing. Click onset
and final 100ms RMS are exercised in the browser regression; final measured
values will be appended after the coordinated port becomes available.

Feature gate core total: 134 tests; feature commit `00e4917`.

AAC boundary regression PASS: a source click at 0.5s, stretched at 2×, begins at
**0.251542s** versus target 0.250000s (**+1.542ms**, less than one 30fps frame).
Final 100ms decoded RMS **0.250185** versus source sinusoid RMS **0.258950**
(96.6%, within the 80–120% codec tolerance). Browser decoded length 1.001333s
(+1.333ms), HTMLMediaElement container duration **1.000000s**. ffprobe also reports
video/audio/container **1.000000s**. All 58 AAC packets are retained; the file and
probe are in `assets/2026-09-06-pitch-speed/` for review.

AAC follow-up gate: **PASS**, all 9 steps; core 134, web 559, desktop 72,
scripts 11, E2E 56. Full summary: `2026-09-06-pitch-speed-aac-gate.md`.

Final cache/model hardening: changed media records conservatively invalidate
both decoded and stretched audio, even when OPFS relink keeps the same key and
size. Revision guards prevent late old decodes from replacing the new buffer;
a regression test resolves old/new decodes out of order and verifies only the
replacement is replayed. Committed speed/ramp/trim/toggle edits restart the
rolling schedule, while precision gestures wait for commit/cancel. One bounded
latest preview request follows the active render, so an edit during rendering
cannot leave the new key unrendered. The 60s E2E verifies a live 2×→0.5× edit
requests a second worker render. Detached audio carries preservePitch and its
speed keyframe track. Core tone checks also measure dominant spectral frequency
using a Hann-windowed Goertzel scan (200–1000Hz, 2Hz grid), with ±2% tolerance.

Final gate: **PASS**, all 9 steps; **778 unit tests** (core 134, web 561,
desktop 72, scripts 11), **56 E2E tests**, production build and OSV audit pass.
Summary: `2026-09-06-pitch-speed-final-gate.md`. The feature and AAC correction
also each passed their own complete gate before their separate commits.

Scope clarification: negative-speed preview retains the existing silent path;
negative-speed export retains the legacy reverse cursor with linear interpolation.
Pitch preservation is not applied to reverse. Preview requests exceeding the
128MiB source/output admission cap retain varispeed, while export renders its
bounded timeline chunks through the worker. Metadata-only media-record changes
conservatively invalidate audio caches too, to cover same-key/same-size relinks.

## B′2 round 2 — rebase and Claude review (2026-09-06)

Rebased onto `origin/main` **ac10c1d** after the explicitly requested fetch.
Conflicts: `apps/web/src/i18n/messages.en.ts`, `messages.ko.ts`,
`docs/07-work-order.md`. Kept C3 funnel keys before branch keys, four-space
append-only translations, and both work-order notes. No semantic change in
rebase; i18n parity **5/5 PASS** before review edits.
Rewritten commits: `00e4917 → f5e4fe9`, `566e271 → 85628fb`,
`bf5ce34 → 27128d1`.

| Review | Result and evidence |
| --- | --- |
| H1 full source copied per chunk | Fixed: renderer transfers source subranges with `sourceStartSample`; absolute clip mapping remains in DSP. 250ms timeline/source margins cover four pre-roll hops, overlap and correlation search. Six 10s requests over a 60s stereo source spy actual worker `postMessage` bytes and require ≤2× source size; full/cropped DSP equivalence also tested. |
| H2 stale preview | Partly already reflected in **bf5ce34 / 27128d1**: playback-key subscription restarts playback on speed/trim/toggle; asset revision blocks late relink decode; next-key handoff. Remaining issue fixed: per-clip keyed AbortControllers, stop/relink/key replacement abort, current project-store clip guard before caching, two worker slots with abortable admission, no global stale promise chain. Worker termination interrupts synchronous DSP itself. Controlled delayed-results test proves stale output is not cached and replacement starts before its reply. |
| H3 worker failure | Fixed: explicit Worker availability check; construction/CSP, worker error and timeout rejection; mixer catches non-cancellation failures, uses varispeed for remainder of export, records `pitchFallback` on result. Completion panel and success toast provide translated informational notice. Worker lifecycle tests cover missing/CSP/error/timeout; mixer fallback tests cover missing/error/timeout. Cancellation still cancels export. |
| M1 delayed swap | Fixed: successful current render reschedules from AudioContext-derived timeline-now immediately, with 20ms gain fade of old/new scheduling. Dedicated gain nodes keep volume automation intact. Preview test observes new source scheduling at completion without waiting for refill. |
| M3 permanent hint | Fixed: Zustand render state keyed by current clip mapping exposes rendering/ready/fallback. Render progress shown only while rendering; ready/idle hidden under C2 guidance contract; fallback is informational. Admission failures also report fallback; failed keys do not repeatedly render. |
| M4 ramp support | Fixed: a valid ≥2-key speed ramp determines range instead of the unused constant speed. Regression covers constant 8× plus supported 0.25–4× ramp, then unsupported ramp endpoint. |
| AAC compensation | **Already reflected: 566e271 / 85628fb**, independent `fix(export)` commit. Keeps all AAC packets, estimates encoder priming, supplies preroll, edits presentation timing; mux tests assert packet payload retention. That commit already added decoded audio duration, onset ±1/30s, final-100ms RMS and container duration assertions (bf5ce34 only formatted that block). This round additionally requires an audio track and reads the audio `tkhd` presentation duration; raw packet duration is intentionally allowed to exceed presentation duration. |
| M2 one clip per pass | Fixed with per-clip pending map and two concurrent worker slots; additional jobs wait before source copying, aborted queued jobs are removed. |
| Mono double copy | Fixed: mono is rendered/effected once and mixed into both output channels. |

### Same-machine audio export timing

Reproduce: `node scripts/pitch-export-benchmark.mjs 27128d1` from repository root.
Uses local installed Chromium, real compiled worker DSP and ProjectAudioMixer,
48kHz ten-minute stereo 440Hz PCM at 1×, 20×30-second output chunks, no effects.
The decoded fixture is preallocated; these are **audio mixing/export-stage**
times, excluding file decode, video encode, AAC encode and download. Baseline
source is read with `git show`; no second worktree or network is used.

| Revision | Elapsed | Worker source bytes | Asset bytes | Ratio |
| --- | ---: | ---: | ---: | ---: |
| bf5ce34 before | 14,747.20ms | 4,608,000,000 | 230,400,000 | 20.000× |
| round 2 after | 3,113.20ms | 237,696,000 | 230,400,000 | 1.0317× |

Single paired run: **4.74× faster**, source copies down **94.84%**, no fallback.
A subsequent bounded-worker-admission change retains identical sequential
export behavior (the benchmark exports one chunk at a time).

AAC regression probe: Mediabunny's packet-based audio `computeDuration()` is
1.108s because all padding packets remain; `ffprobe -select_streams a` reports
start 0.000000 / duration **1.000000**. Therefore packet duration is not the
presentation-length assertion. The E2E independently inspects the audio track
header, decodes audio and checks audible onset/tail, and inspects container time.
AAC-unavailable browsers retain the existing explicit codec annotation; audio
assertions run when AAC support is reported.

### Deferred lower-priority items

M5 correlation scoring still samples `j += 8` (existing coarse delta then ±3
sample refinement does not remove this sampling); M6 dedicated 30s phase-jump
metric; M7 worker reuse (per-job termination deliberately supports cancellation);
M8 production performance-measure separation; full `pitchRevisions` cleanup;
energy-reference scan constrained to trim (now reduced to transmitted window);
additional malformed-number/NaN hardening; relocating the old baseline script;
`packages/core/src/audio/index.ts` barrel. No dependency or app-network addition.

Full validation is recorded in `2026-09-06-pitch-speed-round2-gate.md`. An initial
lint run caught new benchmark-script formatting and a preliminary E2E assertion
incorrectly constrained raw AAC packet length; both were corrected before the
final gate. App-network prohibition remains; coordinator explicitly allowed
only the standard gate's install/audit/browser-download network operations.

Final gate: **9/9 PASS**, **823 unit tests** (core 135 + web 605 + desktop 72 +
scripts 11), **57 Chromium E2E PASS**. AAC decoded duration **1.001333s**,
onset **0.251542s** vs 0.25s expected, tail RMS **0.250185**, container 1s.
60s preview: first sound **69.89ms**, worker roundtrip **133.00ms**, DSP
**121.92ms**, largest new main copy slice **0.36ms**. No skipped gate steps.

## B′2 round 3 — AAC fallback and integration cleanup (2026-09-06)

- AAC calibration is optional: absent decoder, unsupported decode or correlation
  failure leaves `primingSamples = 0`, omits correction edit-list metadata and
  does not add calibration preroll/end padding to the actual export. Audio
  encoding continues and `aacCorrectionFallback` reaches the completion panel
  and informational toast (en/ko: “AAC 시작 보정을 적용하지 못했습니다”).
- `Mp4Writer` no longer retains encoded packets for a re-mux. The two-entry
  edit-list reservation is a structural property of the pinned Mediabunny
  version (asserted by `mp4-writer.test.ts`), so a presentation failure at
  finalize can only follow a dependency change; in that case the packets
  already sit one second late and no in-place rewrite can save the file, so
  `finalize()` throws `AAC presentation could not be applied: …` instead of
  shipping late audio. Holding every packet for the rare re-mux kept a second
  full copy of the encoded payload alive past Mediabunny's own release at
  finalize (about the size of the file itself at the peak, so ~2.6 GB for a
  10-minute 4K export). The +1s reservation now has an explanatory comment.
- Full exporter-path regressions use real AAC/video fixture packets and the
  real Mp4Writer. Two fallback cases (missing AudioDecoder, correlation
  failure) produce both tracks, preserve every AAC packet byte, feed the
  encoder unshifted, unpadded frames, start audio at timestamp zero and set
  the result notice flag. A deliberately missing edit-list reservation is a
  third case that must reject with `AAC presentation could not be applied`.
- [Unified benchmark script](../../scripts/pitch-export-benchmark.mjs) defaults
  to ancestor `27128d1` and reports a clear error for an unresolved Git ref before
  launching a browser. The former documentation-directory script was removed;
  its original varispeed frequency/alias/speech probes are retained with
  `node scripts/pitch-export-benchmark.mjs --varispeed`. Both modes ran successfully.
  A fresh comparison gave 13,421.10ms / 3,429.50ms and unchanged transfer bytes
  4,608,000,000 / 237,696,000 (baseline/current); same audio-stage scope as round 2.
- Deleted only the branch-added unused `speed.pitchRendering` keys; appended the
  AAC notice to both locale files. No other existing translation lines changed.
- Preview admission now uses the shared renderer source-window calculation and
  output bytes, so a short clip in a ten-minute stereo source can render. The
  controlled preview regression now uses that long-source case; cropped/full
  DSP equivalence additionally covers trimIn 500ms, a 0.5–1.5× ramp and 2s offset.
- `ExportResult.pitchFallback` and the new AAC flag are readonly.

B′3 audio-bus follow-up (record only): `detachAudio` currently copies only speed
keyframes, drops the volume curve on the detached clip, and sets the original
clip's base volume to zero while leaving its keyframes intact. Define volume
curve/effect ownership and true source muting in B′3; this round deliberately
makes no detach behavior change.

Round-2 deferred list is superseded only for baseline-script consolidation;
M5–M8, revision cleanup, trim energy reference, malformed-number hardening and
the core audio barrel remain deferred. Validation: see
[round-3 gate](2026-09-06-pitch-speed-round3-gate.md).


## B′2 follow-ups — 2026-09-07

Baseline: `1c3c0e4b74a9d36a9c05cb8e81da74818e000f1b` (`origin/main`).
Recovered this worktree onto `codex/b2-followups`; the integrated uncommitted work
was preserved in stash `b2-pre-followups-integrated-backup`. No push or main merge.

### M5: dense correlation and offline CPU comparison

Correlation now scores every overlap sample (`j++`), retaining the coarse delta
search followed by ±3-sample refinement. Dense tail/candidate samples are cached
once per hop so interpolation is not repeated for every candidate.

Reproduce offline: `node scripts/pitch-export-benchmark.mjs --dsp 1c3c0e4`.
48kHz, two-second stereo sine input; one warm-up then median of five renders per
fixture in the same Node process, baseline before working tree. Goertzel scans
expected frequency ±800Hz in 2Hz steps over a Hann-windowed 16384-sample segment.
Elapsed wall time is a local single-thread DSP CPU proxy, not a cross-device guarantee.

| Input Hz | Speed | Baseline ms | Dense ms | Change | Dense dominant Hz | Error |
| --- | --- | --- | --- | --- | --- | --- |
| 440 | 0.5× | 34.140 | 40.654 | +19.1% | 440 | 0.00% |
| 440 | 1.37× | 11.200 | 12.585 | +12.4% | 440 | 0.00% |
| 440 | 2× | 7.722 | 8.684 | +12.5% | 440 | 0.00% |
| 6000 | 0.5× | 30.778 | 34.761 | +12.9% | 6000 | 0.00% |
| 6000 | 1.37× | 11.578 | 12.668 | +9.4% | 5994 | 0.10% |
| 6000 | 2× | 7.507 | 8.555 | +14.0% | 6000 | 0.00% |
| 10000 | 0.5× | 31.015 | 35.107 | +13.2% | 10000 | 0.00% |
| 10000 | 1.37× | 11.118 | 12.543 | +12.8% | 10000 | 0.00% |
| 10000 | 2× | 7.320 | 8.554 | +16.9% | 10000 | 0.00% |

All fixtures retain dominant frequency within ±2%; max observed error is 0.10%.
The baseline also passes this frequency-only metric: pure tones alone do not prove
correct overlap alignment. The change removes correlation downsampling itself;
this audit does not claim broad perceptual improvement from these fixtures.

### M6: adjacent chunk phase continuity

Increasing a finite preroll does not reconstruct the accumulated WSOLA phase.
Instead, `StretchContinuation` preserves the cursor, previous anchor, overlap-hop
position and linked reference channel before the next range's first overlap hop.
The worker returns that checkpoint; `pitch-renderer` scopes it by source identity,
clip ID and pitch configuration in a WeakMap with at most 32 variants per source.
Only exactly adjacent output sample positions resume it; seeks use the existing
40ms preroll. Source copies retain the existing 250ms margins; no enlargement needed.

48kHz, 443Hz sine at amplitude 0.5, first range 30s and next range 100ms:

| Speed | Baseline absolute boundary jump | Checkpoint jump | Threshold |
| --- | --- | --- | --- |
| 0.5× | 0.590724 | 0.026845 | <0.05 |
| 1.37× | 0.160836 | 0.020804 | <0.05 |
| 2× | 0.517846 | 0.028894 | <0.05 |

The 0.05 threshold exceeds the ordinary adjacent-sample change of this fixture
(~0.029). Additional regressions compare concatenated output sample-for-sample
with a single render across a non-hop-aligned split, verify seek rejection of an
old checkpoint, and exercise cropped source copies through pooled workers.
Checkpoint eviction/interleaving can cause a cold start; independent seek renders
are not promised to reproduce the phase of a full render from the clip beginning.

### M7–M8, detach and LOW items

- M7: two admitted jobs reuse up to two workers; successful replies clear handlers
  and timers and return the worker to the pool. Cancellation immediately terminates
  active DSP; fatal worker errors, timeout and failed transfer also discard the worker
  because a failed/busy worker cannot safely be reused. Queued aborts allocate no worker.
  Lifecycle tests cover reuse, maximum size, queued cancellation, active replacement,
  missing/CSP/error/timeout paths and real-DSP checkpoint transfer.
- M8: production `pitchMainSlice` directly invokes its callback without reading the
  clock or calling `performance.measure`/`clearMeasures`. Worker DSP timing is also
  development-only. Development/e2e measurement remains available; production bypass
  has a unit test and the production build is in the gate.
- detachAudio: the detached clip inherits static volume plus volume and speed
  keyframes; the original retains speed mapping with volume 0 and no volume track,
  so automation cannot unmute it. Unit coverage also checks the source input is intact.
- LOW: channel energy scans use only the available trimmed source range; nonfinite
  PCM values become zero before interpolation/scoring. Added `audio/index.ts` and
  routed the core root barrel through it. Trim-reference and NaN/Infinity tests added.
- `pitchRevisions` cleanup remains owned by B′3 in `preview/audio-engine.ts` and was
  explicitly escalated to the coordinator. That file and all other B′3-owned files
  were not edited in this worktree.

Validation: see [follow-up gate](2026-09-07-pitch-speed-followups-gate.md).

Actual Chromium export-stage check (`node scripts/pitch-export-benchmark.mjs 1c3c0e4`):
10-minute 48kHz stereo, 20 × 30s chunks, decoded PCM fixture and audio mix only:

| Metric | Baseline | Follow-up |
| --- | --- | --- |
| Elapsed | 3523.1ms | 5295.9ms (+50.3%) |
| Pitch workers constructed | 20 | 1 |
| Transferred PCM | 237,696,000 bytes | 237,696,000 bytes |
| Pitch fallback | false | false |

This full audio-stage measurement has higher overhead than the Node DSP microbenchmark;
worker reuse reduces construction count but does not offset dense correlation CPU cost.
Both results are reported without claiming an overall export speedup.
E2E preview probe: first sound 75.20ms, DSP 248.05ms, one worker, longest main task 0ms,
maximum measured pitch main slice 1.04ms (development build).
