# B’4a color audit — 2026-09-07

The original B’4a audit and gate history are preserved below. The B’4b implementation,
correctness, signal/tag verification and performance results follow in the
“B’4b managed pipeline” section.


Base: fetched origin/main `1ba350ba73272abf7a8b3d872c691a0d7e0271ae`.
Working checkout: `HyunjoonKwak/codex-b4-color`, retained by coordinator approval.
Scope was explicitly split: this round ships scopes and evidence; B’4b owns
linear compositing, effect domains, LUT space metadata, HDR warnings and export
color configuration. See [decision](../decisions/2026-09-07-color-management.md).

## Corrections to the initial inventory

Scopes already existed at the base in `preview/scopes.ts` and `scopes-panel.tsx`,
with a desktop right-panel tab. They used a separate 100ms timer/rAF chain, CPU
readback/computation/painting, unbounded portrait sample height and no cancellation
of the pending timeout. Vectorscope coefficients were BT.601 while histogram
luma coefficients were BT.709. No clipping values, RGB parade, displayed luma
histogram or reference scale existed. This round improves these existing features.

`renderer/gl.ts` uploads RGBA8 with default browser color conversion. PingPong and
ScratchPool allocate RGBA8 targets, and compositing targets the default framebuffer.
Exposure multiplies encoded samples and clamps each pass; blur averages encoded
samples. The shared Compositor already serves preview and export. Source probe
metadata has no transfer/primaries contract, but `mp4-demux.ts` forwards
Mediabunny’s decoder configuration: saying all input tags are always ignored is
incorrect. Browser decoding/upload can do part of the conversion.

## Reproducible GPU fixtures

Run `node scripts/color/audit.mjs docs/evaluations/2026-09-07-color-baseline.json`.
Uses installed Playwright Chromium, a local ephemeral HTTP server, repository
exposure/gaussian-blur GLSL and actual WebGL2 texture upload/draw/readPixels.
No downloaded fixtures or user media. This is a shader-level GPU harness, not a
full-project pixel test. Full-compositor passthrough regression belongs to B’4b.

Inputs: all 256 sRGB gray codes; 18% linear gray quantized to code 118; white,
yellow, cyan, green, magenta, red, blue and black bars; near-highlight codes
230/250/255; a black/white edge and premultiplied half-white over black.
Reference EOTF is sRGB’s piecewise 2.4 function, not a simple 2.2 power.

| Fixture | Current GPU code | Linear-light reference code | Finding |
| --- | ---: | ---: | --- |
| code 16, +1EV | 32 | 26 | linear gain 2.788× rather than 2× |
| code 64, +1EV | 128 | 90 | linear gain 4.210× rather than 2× |
| 18% gray (118), +1EV | 236 | 162 | linear gain 4.630×, 131.5% above intended gain |
| code 128, +1EV | 255 | 176 | early clipping |
| code 180, +1EV | 255 | 245 | early clipping |
| code 230 / 250 / 255, +1EV | 255 | 255 | output clips in both references |
| black/white blur edge x=127 | 102 | 170 | dark fringe, −68 codes |
| half-white over black | 128 | 188 | dark composite, −60 codes |

Neutral exposure pass reproduces every ramp channel and color-bar channel exactly:
maximum byte error 0. Blur’s reference encodes the measured binary weighted coverage,
so it includes approximately one-code intermediate measurement quantization. This
neutral fixture demonstrates a baseline invariant, not a new managed bypass.

## Input color tags and output MP4

Run `node scripts/color/output-tags.mjs` to regenerate
[color tag evidence](2026-09-07-color-output-tags.json). It uses real raw RGBA
VideoFrames with explicit metadata and the same RGBA8 upload format as the app;
this isolates tag handling from file/container decoder variation.

| Raw RGB input and frame tags | Uploaded RGBA8 RGB | Delta from input |
| --- | --- | --- |
| (180,100,60), sRGB / BT.709 primaries | (180,100,60) | (0,0,0) |
| (180,100,60), BT.709 transfer / primaries | (180,100,60) | (0,0,0) |
| (180,100,60), Display P3 / sRGB transfer | (193,95,49) | (+13,−5,−11) |

All three readbacks have GL error 0. P3 gamut conversion occurs in this Chromium
path; Rec.709 versus sRGB transfer gives identical bytes in this fixture. The app
has no explicit decoded-representation contract and cannot guarantee consistent
handling across HTML image/video, VideoFrame, ICC-tagged files or browser versions.
This does **not** establish that every tagged input file is ignored. ICC file
matrix and HDR iPhone dogfooding remain unmeasured.

The output harness uses a real WebGL canvas VideoFrame, real VP9 VideoEncoder,
and pinned Mediabunny 1.55.5 with unchanged encoder metadata forwarding as in
`Mp4Writer`. Canvas frame: primaries BT.709, transfer sRGB, matrix RGB, full range.
Encoder decoderConfig: SMPTE170M primaries/transfer/matrix, limited range.
The resulting 700-byte one-frame MP4 contains **one `colr`/`nclx` box with
6/6/6, range flag 0**, not requested BT.709 1/1/1. This is a real encoded/muxed
output fixture, not a complete UI export or H.264 guarantee. Mediabunny’s
`isobmff-boxes.ts` writes `colr` when decoderConfig.colorSpace is nonempty; absence
is possible when the encoder provides no color metadata. No muxer patch is needed
to support the box. Correct conversion and consistent codec/container tagging are
B’4b work; blindly relabeling bytes would be incorrect.

## B’4a implementation and resource limits

Pure computations moved to `src/scopes/compute.ts`. Histograms include RGB and
encoded BT.709 luma, waveform includes luma and RGB parade, vectorscope uses
BT.709 Cb/Cr, and any-channel near-black (≤1) / near-white (≥254) counts and sample percentages are shown.
NEAREST point sampling preserves source code values without interpolation. Counts
describe the sampled output only; tiny clipped areas between sample locations can
be missed, and percentages are not full-frame area estimates.
Displays identify full-range 0–255 and approximate IRE. HDR is not calibrated.

The viewport publishes immediately after successful rendering, before a
non-preserved WebGL drawing buffer can be discarded. A GPU framebuffer blit
uses NEAREST to reduce the output to at most 256×144 with preserved aspect (portrait 1080×1920
becomes 81×144). RGBA8 pixel-pack-buffer readback is fenced, then polled at rAF
with zero wait timeout; CPU copy occurs only once signaled. All modified GL
bindings are restored. One worker owns calculations and painting; transfer lists
move the small pixel buffer and result ImageBitmap; the worker returns the pixel
buffer for the next capture and reuses one scratch canvas, and bitmaprenderer presents
it. The scopes-only readback attachment does not change the compositing pipeline.

There is one in-flight job and at most one capture per rAF. Under GPU/worker
backpressure intermediate frames coalesce; a skipped paused frame requests a
fresh render when free. This can produce fewer scope updates than video frames.
Mode changes update a ref and request a redraw without restarting the worker.
Unmount unsubscribes, terminates the worker, cancels fence polling and frees GPU
resources. Context loss clears the reader and restore requests a fresh capture;
generation checks discard obsolete GPU and worker results. A panel failure
retries once before showing unavailable. There is no recurring work with scopes closed.
A mobile Scopes drawer provides 390px access. First-allocation/driver/context-loss
latencies are not a real-time guarantee; steady-state costs are measured below.

## Validation and performance

Pure calculation and scheduling/readback tests: 11 PASS. Product E2E covers all
five modes, nonzero white-patch counts and 390px panel bounds. Web lint and
TypeScript PASS. Full gate and measured 1080p before/after results follow. B’4a changes no rendering
math; its baseline is scopes closed versus enabled with the same cached still
project. Shader microbenchmark includes readback synchronization and is separate
from actual editor playback intervals. Measurements are environment-specific,
not a universal ≤1ms guarantee.

### Before/after scope evidence

- `node scripts/color/scopes-baseline.mjs` loads a checked-in copy of the `1ba350b` arithmetic
  (`scripts/color/scopes-baseline.fixture.ts`, independent of git history)
  and current kernels. [Kernel results](2026-09-07-color-scopes-kernels.json):
  three kernels per iteration, 200 samples after 20 warmups, Node CPU baseline
  240×135 p50/p95 **0.311/0.324ms**, current 256×144 **0.385/0.404ms**.
  This is not an algorithm speedup claim: the sample is 13.8% larger, and current
  application work is moved off the main thread. Browser worker costs below are
  the selected histogram plus drawing and clipping, not the three-kernel sum.
- BT.709 red target is **(99,0)** in the 256-grid. Old BT.601-style arithmetic
  placed it at **(106,64)**, both a coefficient discrepancy and a half-scale display. Round 2 maps
  Cb/Cr ±0.5 to the full grid extent, clamps boundary primaries, and scales
  the graticule to match. The new pure test fixes the expected coordinate and neutral
  center (128,128); the UI also draws six full-amplitude primary/secondary targets.
- `node scripts/color/frame-sync.mjs` exercises a visible, non-preserved GL canvas
  with five paused white frames. The old 100ms+rAF sampling schedule reads black
  in **5/5** trials (RGB error **255** per channel, delay **102.8–107.1ms**).
  The repository’s new immediate PBO reader returns white in **5/5**, RGB error
  **0**. [Frame lifetime results](2026-09-07-color-scopes-frame-sync.json).
  This isolates framebuffer lifetime; it is not a claim about every decoder’s
  timestamps. The product E2E separately verifies nonzero white-patch counts
  after a paused render and after every mode change.

### Round 2 sparse clipping regression

`node scripts/color/frame-sync.mjs` now also clears a 1920×1080 GL buffer to
black and writes 576 isolated white texels at known sample centers (0.0278%
of source pixels). NEAREST returns only codes **0 and 255**, with **576 / 36,864
near-white samples (1.5625%)**; this intentionally sample-aligned fixture tests
code preservation, not unbiased area estimation. A LINEAR regression would
blend each white texel with surrounding black and fail the exact code/count
assertions. The harness also verifies identity reuse of the returned CPU buffer.
Unit regressions cover all 81 portrait waveform columns, context loss/restore
with obsolete results rejected, and readback reentry. Product E2E injects a
transient scope error and requires automatic recovery without changing mode.

### 1080p product measurement

Reproduce with `COLOR_AUDIT=1 pnpm --filter @movie-desk/web exec playwright test
 e2e/scopes.spec.ts` when port 32119 is free. The fixture is an imported black/white
PNG on the actual timeline; playback runs 130 rAF ticks per condition at a checked
**1920×1080** drawing buffer. First ten intervals are omitted. Counts/timings:
[JSON](2026-09-07-color-scopes-performance.json),
[390px screenshot](2026-09-07-color-scopes-390.png).

| Measurement | scopes closed | scopes enabled |
| --- | ---: | ---: |
| Playback interval p50 | 16.665ms | 16.665ms |
| Playback interval p95 | 18.510ms | 18.560ms |
| Playback interval max | 18.650ms | 34.730ms |
| Scope capture + fence polls + CPU copy p50 / p95 / max | none | 0.035 / 0.050 / 0.055ms |
| Bitmap display submission p50 / p95 / max | none | 0.020 / 0.030 / 0.035ms |
| Worker compute + scope paint p50 / p95 / max | none | 0.310 / 0.345 / 0.645ms |

There were 63 scope responses over 130 playback rAF ticks: about 30 scope updates
per second under the one-in-flight backpressure rule, with no more than one
capture per rAF. Measured capture + display submission stays below 0.090ms (sum
of separate maxima), meeting the 1ms budget for the instrumented scope work.
React scheduling/commits, first allocation and arbitrary GPU driver stalls are
not included; this is not a hard real-time guarantee for an entire editor frame.
No linear rendering math changed, and no speedup is claimed from tiny differences
in overall playback timing.

The initial `createImageBitmap(canvas, resize...)` attempt was rejected after
measuring capture p50/p95 **4.47/5.47ms** at **796×447**, already over budget.
[Rejected capture attempt](2026-09-07-color-scopes-bitmap-attempt.json) retains
actual dimensions; its historical note incorrectly called the run 1080p, which
is why the final harness asserts both drawing-buffer dimensions. The selected
PBO path avoids this synchronous full-frame snapshot cost.

### Final gate

`COLOR_AUDIT=1 pnpm gate --report docs/evaluations/2026-09-07-color-gate.md`:
**9/9 PASS** — frozen install, versions, lint, typecheck, unit tests, OSV audit,
production build, Chromium installation and browser E2E. Unit counts: core
**153**, web **653**, desktop **72**, scripts **11** = **889**. Chromium E2E:
**62 PASS** (including one new scopes journey). [Gate table](2026-09-07-color-gate.md).
The offline frame lifetime/sparse clipping and kernel comparison harnesses also
passed; the frozen baseline fixture removes the need for historical git objects. No dependency or lockfile changes, no exporter/audio edits,
no push or main merge. B’4b remains a separate implementation/review round.

## B’4b managed pipeline (implemented; full gate passed)

Base `0e6804a`; same branch. The new scene/effect targets are linear Rec.709,
premultiplied in linear light. The compositor keeps a legacy bypass for an opaque,
single, native-resolution untransformed clip; resampling, effects and compositing
use the managed scene. Presentation encodes once to sRGB. Encoded artistic effect
groups convert at domain boundaries, process straight RGB, and restore premultiplication.
Blur filters coverage along with premultiplied RGB. Adjustment captures preserve
the scene target's storage format instead of reallocating RGBA8 via copyTexImage2D.

`node scripts/color/managed.mjs` runs the current and `0e6804a` compositors on a real
WebGL context with a deterministic in-memory source adapter (actual compositor,
effect registry, shaders and core timeline functions). It compares **147,456**
synthetic ramp channels and **230,400** channels from the checked-in VP9 MP4:
**zero mismatches** in both bypass fixtures. GPU extension suppression forces
SRGB8_ALPHA8 fallback, so the fallback result is not a mocked arithmetic result.
The baseline requires the documented base Git object; there is no network access.

| Managed GPU check | Result |
| --- | --- |
| Code 118, exposure +1EV | 236 before → 162 after |
| Linear scene gain at code 118 | 1.99986862198× (half-float quantization; ideal 2×) |
| Code 180, +3EV then −3EV | 180; highlights survive intermediate values above one |
| White at half opacity over black | 188 in RGBA16F and SRGB8_ALPHA8 |
| −3EV then +3EV, all 256 gray codes, RGBA16F | 256 distinct codes, maximum error 0 |
| Same chain, SRGB8_ALPHA8 | 100 distinct codes, maximum error 4 (SwiftShader) / 6 (Metal); visible banding risk |
| Quarter-intensity 1D LUT at source code 118 | sRGB 30; BT.709 encoded 42; linear 60 |

The LUT fixture maps 1 to 0.25; interpolation retains the existing 8-bit LUT texture
precision. A selected space applies to both LUT input and output. The effect
parameter persists with the project, and changing interpretation/importing a LUT
now records history instead of using the slider's history-bypassing setter.
An explicit sRGB assumption is visible for old LUTs. Unsupported space strings
fail instead of being silently guessed.

Every visual definition declares its working space. The JSON records every
effect's parameters and old/new gray result (including encoded identity checks).
These samples are not an exhaustive artistic-equivalence claim. In particular,
linear wheels/white balance/grain/vignette intentionally change appearance.
Unbounded exposure is tested separately from the clipped SDR output boundary.

### Output signal and tags

`node scripts/color/managed-output.mjs` checks every shipped preset with the real
encoder and pinned muxer. It then decodes **without injecting color metadata**,
requiring the bitstream to identify BT.709 independently of container metadata.
All six presets encode successfully in this local Chromium environment; each
reports BT.709 primaries/transfer/matrix, limited range, one matching 1/1/1 `colr`,
and decoded center luma **106** for sRGB code **118**. H.264 and VP9 are both tested.
An unsupported encoder/configuration on another browser is not relabeled.

| Preset | Dimensions | Codec | Encoder / bitstream / MP4 |
| --- | --- | --- | --- |
| Family message | 1280×720 | H.264 | BT.709 limited / BT.709 limited / 1/1/1 limited |
| YouTube 1080p | 1920×1080 | H.264 | BT.709 limited / BT.709 limited / 1/1/1 limited |
| YouTube 4K | 3840×2160 | H.264 | BT.709 limited / BT.709 limited / 1/1/1 limited |
| TV / Tablet | 3840×2160 | H.264 | BT.709 limited / BT.709 limited / 1/1/1 limited |
| TikTok / Reels | 1080×1920 | H.264 | BT.709 limited / BT.709 limited / 1/1/1 limited |
| Web | 1920×1080 | VP9 | BT.709 limited / BT.709 limited / 1/1/1 limited |

The CPU conversion runs in a dedicated worker using two transferable RGBA/I420
slots and drains frames in timestamp order, with the existing encoder queue bound.
Worker absence uses the same conversion synchronously; worker failure, timeout
and cancellation reject pending frames and release resources. A GPU-packing
attempt was rejected: the 30-frame 1080p boundary+encoder benchmark rose from
167.4ms to 1474.3ms. Its measured tags and times are preserved in
[color GPU packing attempt](2026-09-07-color-gpu-pack-attempt.json); the rejected
shader is not shipped. This is a component experiment, not a 10-minute estimate.
Complete 10-minute exporter measurements and the bounded-overlap follow-up are
recorded below, separately from this component experiment.

### Decoded/uploaded representation evidence

| Input path | Gamut handling | Transfer handling | Classification / measured evidence |
| --- | --- | --- | --- |
| WebCodecs raw RGBA, sRGB | Browser Rec.709 | sRGB inverse | (180,100,60) → (180,100,60) after neutral managed processing |
| WebCodecs raw RGBA, BT.709 | Browser Rec.709 | Runtime probe selects BT.709 inverse when samples survive unchanged | (180,100,60) → (188,114,75); analytic sRGB output (187.60,113.60,75.35) |
| WebCodecs I420 / NV12, BT.709 limited | Browser YCbCr/RGB and Rec.709 | Same probed BT.709 inverse, separately exercised with actual YUV planes | Y117/U128/V128 uploads as RGB118; managed display RGB131, analytic unquantized reference130.12 (within 1 code) |
| WebCodecs raw P3 / sRGB | Browser converts gamut once | sRGB inverse; no repeated source-gamut matrix | (180,100,60) uploads (193,95,49), retained by the managed identity |
| DOM video element | Browser SDR conversion | Explicit sRGB assumption; source transfer normalization is not claimed | Approximate; actual 320×180 MP4 bypass matches legacy in every channel; named StateHint in editing and warning in export results |
| HTML image / ImageBitmap, sRGB PNG | Browser image/profile conversion to sRGB | sRGB inverse | Black/white PNG identity has zero mismatched channels for both paths; not an exhaustive ICC or animated-image test |

The VideoFrame probe is repeated per restored GL context. Unit tests cover
preserved transfer, conversion to sRGB and unknown/unclassifiable output; unknown
metadata/probes produce a visible SDR approximation instead of a second guessed
transform. PQ/HLG tags produce an HDR warning, not an HDR accuracy claim.
The old-to-new input results above are interpretation tests, not evidence that
all decoder formats, ICC profiles or browser versions behave identically.

### Effect samples and precision scope

All values below are output sRGB byte codes at the recorded sample coordinate.
Parameters are preserved in [the GPU measurements](2026-09-07-color-managed.json);
neutral settings are deliberate identity checks, not a claim that adjusted looks
are unchanged. Grain depends on the GLSL implementation (the separate Metal
artifact records its own sample). Curves are not currently shipped.

| Effect | Declared space | Before RGB | After RGB |
| --- | --- | --- | --- |
| brightness | encoded | 118, 118, 118 | 118, 118, 118 |
| contrast | encoded | 118, 118, 118 | 118, 118, 118 |
| exposure | linear | 236, 236, 236 | 162, 162, 162 |
| saturation | encoded | 118, 118, 118 | 118, 118, 118 |
| hue | encoded | 118, 118, 118 | 118, 118, 118 |
| color-wheels | linear | 118, 118, 118 | 118, 118, 118 |
| white-balance | linear | 118, 118, 118 | 118, 118, 118 |
| levels | encoded | 118, 118, 118 | 118, 118, 118 |
| vibrance | encoded | 118, 118, 118 | 118, 118, 118 |
| split-tone | encoded | 137, 128, 117 | 136, 128, 117 |
| gaussian-blur | linear | 118, 118, 118 | 118, 118, 118 |
| sharpen | linear | 118, 118, 118 | 118, 118, 118 |
| vignette | linear | 60, 60, 60 | 85, 85, 85 |
| sepia | encoded | 159, 142, 111 | 159, 142, 111 |
| invert | encoded | 137, 137, 137 | 137, 137, 137 |
| grain | linear | 111, 111, 111 | 123, 123, 123 |
| chroma-key | encoded | 118, 118, 118 | 118, 118, 118 |
| bg-remove | linear | 118, 118, 118 | 118, 118, 118 |

The separate spatial probes change an alpha edge 128→188, a sigma-2 blur edge
102→170, and a two-pixel black/white resize 128→188. LUT interpretations are in
the earlier table. Half-float output remains quantized at the final 8-bit SDR
presentation boundary; the fallback loses shadow codes and clips highlights
above one. A persistent precision StateHint makes this limitation visible.

### Playback performance and measurement limits

The machine is an Apple M4 Mac. Default headless Chromium reports SwiftShader,
so a separate `COLOR_GPU=metal node scripts/color/managed.mjs` run explicitly
selects ANGLE Metal. Both runs use an attached 1080p canvas, requestAnimationFrame
and actual compositor/effect work; they do not claim source-decoder throughput.

| Renderer, 1080p +1EV | Legacy interval p50 / p95 | Managed interval p50 / p95 | Main-thread submission p50 / p95, old → new |
| --- | --- | --- | --- |
| ANGLE Metal (Apple M4) | 16.7 / 18.4ms | 16.7 / 18.2ms | 0.1 / 0.4ms → 0.2 / 0.4ms |
| SwiftShader (software) | 16.7 / 18.6ms | 50.0 / 66.7ms | 2.0 / 2.3ms → 3.1 / 5.6ms |

Metal maintains the display cadence; timer-floor `gl.finish` samples (0–0.2ms)
are not precise GPU duration estimates. Software rendering exceeds the +20%
threshold: linear transfer shaders and additional float passes execute on CPU.
This is an explicit software-renderer limitation, not hidden by the hardware
result. Raw measurements are in the [Metal](2026-09-07-color-managed-metal.json)
and [SwiftShader](2026-09-07-color-managed.json) artifacts.

Non-neutral white balance (temperature 0.5, tint 0.2) at gray118 changes
(141,110,103) → (142,108,98); an independent linear arithmetic reference gives
exactly (142,108,98). Color-wheel RGB gain +0.25 changes (148,148,148) →
(131,131,131), also matching the independent linear reference. Both neutral
identities are asserted separately in the GPU invariant suite.

### Complete 10-minute export, graded fixture

`node scripts/color/ten-minute-export.mjs` exports all **18,000** 1080p30 frames
through the real exporter, compositor, bounded encoder queue, muxer and final
Blob. A generated PNG gradient with +1EV and in-memory source/preflight adapters
isolates video work; there is no audio or source-file I/O. These are measured
complete exports on SwiftShader, not 30-frame extrapolations.

| Revision / conversion | Complete time | Output bytes | Delta from legacy |
| --- | --- | --- | --- |
| 0e6804a legacy | 608.7926s | 65,500,182 | — |
| Managed, synchronous CPU bridge | 776.9624s | 212,281,677 | +168.1698s / +27.62% |
| Managed, two-slot Worker bridge | 675.2099s | 212,281,677 | +66.4173s / +10.91% |

The worker reduces the managed run by **101.7525s**. The graded +1EV fixture
preserves gradients that the old encoded exposure clipped; the encoded output
is 3.24× larger, so its extra encoding work is mixed into this delta. **This is
not a pure color-conversion overhead figure.** Evidence: [legacy and synchronous
runs](2026-09-07-color-ten-minute-export.json), [worker run](2026-09-07-color-ten-minute-pipelined.json).
The supervisor requested a no-effect neutral comparison with identical YUV
content to separate that cost; it is recorded in the next section.

### Complete 10-minute export, matched neutral content

`node scripts/color/ten-minute-export.mjs --neutral` runs both complete exporters
with a native-size, opaque black PNG, **no effects**, 1080p30, 18,000 frames,
VP9 6Mbps and the same video-only in-memory adapter. Black is chosen because
sRGB→BT.709 transfer/matrix conversion leaves its ideal limited-range signal
Y16/U128/V128 unchanged; a colored ramp would still change encoder input even
without an effect. The encoder settings, frame count and timestamps are identical.

| No-effect fixture | Complete time | Output bytes | Decoded first-frame plane SHA-256 |
| --- | --- | --- | --- |
| 0e6804a legacy | 287.6616s | 1,067,918 | fba85dc76edb671885fafcac49ec9acf8e6bd598fe2eec42701d84e91279daaa |
| Managed, two-slot Worker | 238.8092s | 1,067,918 | fba85dc76edb671885fafcac49ec9acf8e6bd598fe2eec42701d84e91279daaa |

The controlled end-to-end delta is **−48.8524s (−16.98%)**: the new bounded
pipeline is faster on this matched-content fixture. This includes overlap and
replacing the browser's Canvas-to-VideoFrame conversion; it is not a standalone
arithmetic function benchmark or a claim that CPU conversion is free. The first
lossy-decoded frame has 1,649 luma samples within three codes of ideal black in
**both** paths, with identical full decoded data hashes and all chroma samples128.
An initial check against ideal black exposed that codec error; the final check
compares the two actual outputs. Container/bitstream tags change from SMPTE170M
to BT.709 as intended, while decoded sample bytes match for this neutral content.
See [the full neutral results](2026-09-07-color-ten-minute-neutral.json).

The +1EV result (+66.4173s / +10.91%) remains separately labeled as including
changed image content, extra linear rendering and encoding load. B’6 follow-up:
software-renderer transfer/float-pass optimization and actual-video hardware
10-minute exports, with both matched-content and graded fixtures. The neutral
benchmark shows no remaining positive end-to-end conversion regression in this
local setup; broader hardware/browser/decoder claims require those follow-ups.

### Automated verification scope

Unit tests cover transfer round trips, effect domain declarations, input-probe
classification, BT.709 matrix/range/scanline orientation and two-slot ownership,
reversed worker responses, failures, cancellation and synchronous fallback.
The two new E2Es exercise LUT space selection/undo plus actual exported decoded
pixels, and visible approximation/context restoration plus the GPU invariant
suite. The latter also forces both target types unavailable and verifies that
opaque bypass still works while managed operations fail explicitly.

The first full gate caught an interaction regression: the 12-second migration
toast intercepted an empty-track click in the existing marquee E2E. The notice
is now a dismissible StateHint confined to the preview, so it cannot cover
timeline gestures; the existing test is unchanged. Final gate results below supersede that failed first run.

Final `pnpm gate --report docs/evaluations/2026-09-07-color-linear-gate.md`:
**9/9 PASS**, core155 + web672 + desktop72 + scripts11 = **910 unit tests**,
**64 Chromium E2Es** (183.8s gate step), OSV **167** production packages with
**zero** known vulnerabilities, production build and type/lint checks passed.
Port32119 was checked with `lsof` before each gate/browser run. Catalog diffs
remain append-only (11 keys per language, four-space indentation); no dependency,
lockfile, push, main merge or other-worktree changes. See the [final gate report](2026-09-07-color-linear-gate.md).
