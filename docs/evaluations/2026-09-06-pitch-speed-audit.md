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

Reproduce from repository root: `node docs/evaluations/pitch-speed-baseline.mjs`
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

Reproduce: `node scripts/pitch-export-benchmark.mjs bf5ce34` from repository root.
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
