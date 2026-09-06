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
