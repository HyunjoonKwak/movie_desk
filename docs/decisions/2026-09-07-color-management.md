# B’4 color management decision — 2026-09-07

Status: B’4b implemented on the accepted B’4a design; verification and limits are
recorded in the color audit. B’4a originally implemented only scopes and the audit.
Coordinator approved this split through dispatch ctx_cc52c83a90be. No render color
conversion, effect behavior or export metadata is changed in B’4a.

## Working representation and boundaries

Use scene-linear Rec.709 primaries (the same primaries as sRGB), D65, with
premultiplied alpha **in linear light** for compositing. “Rec.709 primaries” does
not imply the BT.709 transfer function: sRGB and BT.709 transfers differ. Decode
using the transfer of the **actual decoded RGB representation**, convert gamut to
Rec.709, then premultiply. Browser uploads can already perform gamut conversion:
the audit measured P3 conversion. Blindly applying the source file transform a
second time is forbidden. Preserve source tags for provenance and separately
track decoded/uploaded representation; test WebCodecs, video/image elements and
bitmap upload paths individually. Untagged SDR uses an explicit sRGB assumption.

Process spatial resampling, blur and compositing in linear light; do not composite
into an encoded default framebuffer. Keep a linear scene target, including
adjustment-layer/backdrop capture, then encode once at presentation. Unpremultiply
before non-linear transfer or artistic effects and premultiply again afterward;
alpha is coverage and never receives EOTF/OETF. RGB at alpha zero becomes zero.

Preview presentation is sRGB. Export targets BT.709 primaries, BT.709 transfer,
BT.709 YCbCr matrix; range must match the encoder’s actual conversion. A `colr`
patch cannot turn sRGB samples or SMPTE170M YCbCr into BT.709. Configure/verify
encoder output and bitstream VUI together with container tags, or report the
unsupported output configuration. Do not universally override the shared
Mp4Writer’s metadata: proxies and remuxed inputs can have different characteristics.

## Precision and fallback

Preferred scene/effect targets: RGBA16F, with WebGL2 `EXT_color_buffer_float`
(or the relevant supported half-float renderability extension) plus an actual
framebuffer completeness probe. Check filtering requirements and context restore;
extension presence alone is insufficient. Keep highlight values above 1 through
linear intermediates and only clip at a documented SDR output boundary.

Fallback: sRGB-capable texture targets (`SRGB8_ALPHA8`) where renderable, hardware
sRGB sampling decode, automatic attachment encode when writing linear shader
values to sRGB storage, and blending
only where the attachment’s semantics actually guarantee linear destination
blending. Never silently return to encoded-RGBA8 arithmetic. Probe this complete
path; if it cannot implement the required pass, surface a reduced-precision or
unsupported-operation state. Quantization and clipping in this 8-bit fallback are
explicit limitations. Capability selection must leave the legacy bypass intact.

## Effect working-space contract for B’4b

Add a required `workingSpace: "linear" | "encoded"` field to visual effect
specifications (audio effect definitions are outside this change). The compositor
converts only at domain boundaries, not before and after every pass unnecessarily.

| Domain | Effects / operations |
| --- | --- |
| linear | exposure, white-balance, color-wheels, gaussian-blur, sharpen, grain, vignette, transform/fit/rotation, compositing and fades |
| encoded sRGB | brightness, contrast, saturation, vibrance, hue, levels, split-tone, sepia, invert, chroma-key |
| encoded by default, declared input required | 1D/3D LUT; future curves |
| mask/coverage | bg-remove; mask alpha remains independent of transfer |

Exposure means multiplying unbounded linear RGB by `2 ** EV`. White balance and
wheels require neutral/identity tests, and grain is added to linear signal; these
choices intentionally change current looks. Artistic encoded operations use
unpremultiplied encoded RGB. Chroma key comparisons are encoded, while its returned
coverage is applied to linear premultiplied RGB. Neutral/default effects may
bypass only when mathematical identity is proven.

A `.cube` dimension or DOMAIN_MIN/MAX is not a color-space declaration. Persist
LUT input/output interpretation with the effect, with explicit user choice when
metadata is absent (sRGB encoded default, BT.709 encoded or linear Rec.709 options).
Reject unsupported log/gamut combinations instead of guessing. Existing LUTs get
a visible sRGB assumption; import, persistence and undo must retain the choice.

## Compatibility and HDR

A single opaque untransformed SDR clip with no effective color/spatial operations
keeps a pure legacy passthrough path with byte-identical output. The guarantee is
for the bypass case, not simultaneous legacy encoded blending and correct linear
blending: those are mathematically incompatible. Multiple clips, opacity,
resampling or active color effects enter the managed path. Freeze bypass pixels
for ramp, neutral gray, bars and near-clipping fixtures before switching defaults.

User-facing B’4b migration copy: “Color processing now uses linear light. Exposure,
blur and blended clips in existing projects may look different. Original media is
unchanged.” This notice ships with B’4b, not with the scopes-only B’4a release.

HDR rendering, tone mapping, wide-gamut output, PQ/HLG grading and HDR export are
out of scope. B’4b reads HDR tags and warns before treating footage as SDR; it must
not claim accurate iPhone HDR handling. B’4a scopes describe the already rendered
SDR RGB frame, full range 0–255, approximate IRE and sampled clipping. They are not
a source-signal legal-range monitor, calibrated HDR scope or full-resolution
clipping detector.

## Delivery and verification

B’4a: existing scopes repaired and extended, bounded frame-synchronous snapshot,
worker calculation/painting, desktop/mobile access, audit and performance evidence.
B’4b: managed targets and boundaries, effect declarations, LUT interpretation UI,
HDR metadata warnings, verified output tags, transfer round-trip and +1EV tests,
byte-identical bypass tests, export-decoded pixel E2E and capability-fallback tests.

## B’4b implementation refinement (supervisor-approved)

Dispatch `ctx_1defbeeaabee` approved a runtime VideoFrame transfer probe and an
explicit browser SDR approximation for DOM video, rather than adding a new raw
YUV decoder to this batch. A known BT.709 RGB patch is uploaded on each new GL
context: preserved code values select the BT.709 inverse transfer; normalized
sRGB values select the sRGB inverse; unrecognized results explicitly assume
sRGB and surface an approximation warning. Source gamut conversion remains the
browser's upload operation and is not repeated in the shader. This probe does
not make every decoder, ICC profile, or HDR format accurate. The audit separates
raw RGB upload evidence from actual file/decoder evidence.

Canvas2D `colorSpace: "srgb"` alone is not proof of source transfer normalization:
the measured Chromium path preserves BT.709 RGB codes even when drawing into that
canvas. DOM video is therefore labeled as browser SDR approximation in a
persistent dismissible StateHint and in completed export results. A new raw YUV
fallback path is deferred to a separately scoped batch (potentially B’6).

For SRGB8_ALPHA8 attachments, WebGL performs storage encoding, sampling decoding
and destination-linear blending in hardware. Adding another shader encode at
the storage write would encode twice. The implementation therefore uses the
attachment's automatic encoding and probes the complete draw/blend/sample path,
not merely FBO completeness. Unsupported targets fail explicitly; the legacy
bypass remains available. Eight-bit fallback clips above one and loses shadow
precision across attenuation/recovery passes; measured bounds are in the audit.

Export converts the final opaque sRGB presentation bytes to BT.709 transfer and
limited-range BT.709 I420, including an actual 2x2 chroma reduction. Encoder output
metadata must independently report BT.709/BT.709/BT.709 limited range; missing or
conflicting metadata rejects the export. The muxer is not relabeled. This SDR
boundary has 8-bit RGB quantization before YUV conversion, and CPU readback/
conversion costs are measured separately from GPU playback. Export dimensions
use device scale one so the frame layout matches the requested preset.

Storage no longer clips the linear signal between passes (including negative
white-balance/grain/sharpen results). Operations with intrinsic bounded domains,
such as LUT domains, levels, color dodge/burn and hue/saturation gamut projection,
retain their mathematical bounds; those are artistic operations, not target
precision clamps. The outer backdrop clamp is removed in the managed variant so
ordinary extended-range overlay/difference results are not clipped by storage.

The DOM-video approximation uses the direct WebGL upload, preserving that browser
path's existing sample handling. An extra Canvas2D copy does not fix the measured
transfer ambiguity and is therefore not paid on each fallback video frame.
Export conversion uses a dedicated worker with exactly two transferable RGBA/I420
slots; frame N conversion overlaps frame N+1 rendering and the encoder consumes
in order. Worker absence has a synchronous color-correct fallback. Abort, worker
failure and timeout reject pending work and release resources rather than
silently encoding missing or reordered frames.

The migration notice is once per project in local storage when populated clips
may be affected (visual effects, blends, images with possible alpha, transforms
or resampling). The compatibility guarantee is about the legacy render bytes;
BT.709 export deliberately changes the representation and tags at the output
boundary. A no-effect opaque-black performance fixture avoids a content/entropy
change across that boundary; its decoded plane hash and file size are compared
between exporters rather than requiring a lossy codec to reproduce ideal black
without quantization error.


## B’4b review clarification

All 17 blend modes intentionally use linear Rec.709 (`BLEND_WORKING_SPACE`),
including artistic backdrop modes. This keeps blending in the same scene domain
as alpha, light addition and spatial filtering, but reinterprets the encoded
artistic definitions; it is not W3C encoded-blend appearance compatibility.
The audit now includes all 17 actual legacy/new GPU RGB rows, and both migration
catalogs explicitly name the blend changes. Existing grades/textures may need
retuning. Export preflight encodes/flushes the first real frame before the long
loop: present incompatible metadata is fatal; missing metadata is an explicit
approximation warning rather than a delayed whole-export failure.
