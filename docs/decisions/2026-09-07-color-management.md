# B’4 color management decision — 2026-09-07

Status: design accepted for B’4b; B’4a implements only display scopes and the audit.
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
sRGB sampling decode, explicit encode when writing encoded storage, and blending
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
