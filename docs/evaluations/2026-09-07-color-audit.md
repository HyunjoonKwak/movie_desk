# B’4a color audit — 2026-09-07

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
