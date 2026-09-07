# Sequence visual rendering (B′5 Phase 4)

`uploadClip` dispatches a sequence before the media-only `withSource` branch.
It leases an RGBA8 child presentation target and invokes the private recursive
render entry with a child timeline view of the same project. Source acquisition,
seeking and segmentation remain inside the existing source queue. A child media
upload can therefore acquire that queue without waiting on its own parent.

Every public render starts ancestry with the selected timeline ID. Each recursive
call appends its child ID and shares the root invocation's lazily computed
`analyzeSequenceGraph` result. The active frame lane is solely a GPU ownership
key. Missing targets, cyclic targets, repeated ancestors, and
`ancestry.length + child subtree depth > MAX_SEQUENCE_DEPTH` return an empty
clip contribution. The root presents that contribution as black; an otherwise
populated parent keeps its backdrop. Graph preflight intentionally rejects an
invalid subtree before drawing its otherwise valid siblings. Lane/budget
exhaustion retains the existing independent black/empty fallback.

Child time is `trimIn + sourceOffsetForRamp(clip, playhead - clip.start)`.
Existing visibility, effects, transforms, transitions, masks and text animation
then evaluate against that captured child playhead. Parent clip effects and
transforms operate on the rendered child texture through the ordinary clip path.

Presentation targets hold premultiplied sRGB. The child target is cleared with
alpha zero and its output is converted to premultiplied linear pixels in the
parent's fit scratch slot before parent effects/blending. This slot cannot alias
a media fit operation in the same clip because sequence clips are not media
clips. Child leases remain held until parent composition or the frame's cleanup.
For Phase 4 we accept an RGBA8 child boundary for two concrete reasons:

1. Child output has the same premultiplied sRGB interpretation as canvas and
   explicit export presentation. The parent can consume every presentation
   target with one defined sRGB-to-linear conversion. This is a semantic choice,
   not a requirement that prevents a future higher-precision target.
2. The recursive call chain retains child attachments while ancestors wait.
   At 3840×2160, an RGBA8 attachment is 33,177,600 bytes (31.64 MiB), versus
   66,355,200 bytes (63.28 MiB) for RGBA16F. Seven nested attachments alone are
   about 221.5 versus 443.0 MiB, before scene, effects and source allocations.
   The existing 128 MiB single-source target cap does **not** cover this separate
   child scratch pool. Avoiding the extra retained attachment memory is the
   Phase 4 tradeoff, not evidence that the present total memory use is optimal.

This deliberately sacrifices color fidelity inside compounds. On half-float
hardware, a flat timeline keeps RGBA16F intermediate values until final output;
placing those same operations inside a sequence quantizes the child result to
8-bit sRGB before the parent's operations. Each further nesting adds another
quantization boundary. A parent exposure lift may therefore reveal banding that
is absent from the equivalent flat operation chain; values clipped at child
presentation cannot be recovered by a later parent exposure reduction. The
final output precision is a separate boundary in both cases. Constant-color
pixel tests in this phase do not establish acceptable gradients for color work.

**Follow-up: preserve sequence intermediate precision.** Evaluate linear
RGBA16F child attachments when supported, with an explicit color-domain target
contract and an accounted child-memory budget; retain a tested SDR fallback.
Compare flat versus one/two/deep nested gradient ramps, small opacity steps,
and child exposure lift followed by parent reduction. Record quantization,
clipping, GPU cost and peak retained memory before choosing the final policy.
This is a color-fidelity follow-up, not part of the audio or editing-UI phases.

Retention visits every timeline in every active project snapshot, respecting the
current timeline alias. Asset/source/decoder IDs are collected across the tree;
text, shape, raw upload and mask keys include every allocated lane, including
idle lanes used by children in previous frames. Otherwise the next root-only
retain call would delete the child textures before that child becomes active.
Retaining potential keys does not allocate textures or enlarge existing cache
budgets. Independent renders still contribute a union of their resources.

This phase renders sequence visuals only. Nested audio is Phase 5 and editing
UI is Phase 6. See the [evaluation](../evaluations/2026-09-08-b5-phase4-report.md)
for real-GL pixels, flat-project comparisons, paired costs and source freeze.
