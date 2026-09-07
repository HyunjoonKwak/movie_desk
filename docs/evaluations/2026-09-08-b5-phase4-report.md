# B′5 Phase 4 — sequence visual rendering

Implemented recursive rendering of sequence clips already present in a project.
Audio and editing UI remain Phase 5 and Phase 6 respectively. The branch started
cleanly from `origin/main` at `1feb3b5cd58e9c474b86271a493e8ff64e0f23de`.

## Implementation and decisions

- `uploadClip` branches on sequence clips outside the media-only `withSource`
  callback. A child therefore acquires the source queue independently; its parent
  never owns that queue while awaiting the child render.
- Public renders create an ancestry array containing the selected timeline ID.
  Recursive calls append the child ID and share a lazy graph analysis. Graph
  subtree depth plus ancestry length enforces eight timeline levels including
  the root. Active-frame lane numbers remain exclusively resource ownership keys.
- Child time reuses `sourceOffsetForRamp` with the sequence trim and captured
  parent playhead. Child presentation is premultiplied sRGB, converted to linear
  before the parent's existing effects, masks, transitions and transforms.
- Child targets clear transparent. Cyclic, missing and over-depth references
  return empty clip contributions without throwing, preserving any valid parent
  backdrop and giving black output on an otherwise empty root. Graph preflight
  rejects invalid subtrees rather than partially drawing their valid contents.
- Retention collects the whole timeline document for all active snapshots and
  keeps keys for idle allocated lanes too. This prevents the next root frame
  from destroying the previous frame's child resources. Cache caps are unchanged.

The [design decision](../decisions/2026-09-08-sequence-rendering.md) details lease
lifetime, color conversion and the inherited lane/budget exhaustion boundary.
RGBA8 child presentation keeps a uniform premultiplied sRGB presentation
contract and halves child attachment memory compared with RGBA16F (31.64 versus
63.28 MiB per 4K target). This trades away intermediate color fidelity: flat
operations retain half-float intermediates on supported hardware, while moving
them into a compound quantizes to 8-bit sRGB before the parent processes them.
Repeated nesting can expose banding, and a later parent correction cannot
recover values clipped by the child boundary. The pixel tests allow small
nested-conversion tolerance; they do not validate gradients for color grading.
Flat-project comparisons require exact equality.

## Pixel and source-queue evidence

The new `node scripts/color/sequences.mjs` audit uses the production compositor,
core timeline evaluation, text/shape rasterizers and shaders on real WebGL2 Metal.
Media I/O is supplied by fixture canvases/VideoFrames; this measures rendering,
not decode or demux latency. Every render has a five-second deadlock timeout.

[Sequence evidence and nested timing](2026-09-08-b5-phase4-sequences.json) records:

- Direct positive control and one/two nested media levels produce
  `[64,128,192,255]`; eight timeline levels also render that color.
- Missing target, self-cycle, indirect cycle and nine timeline levels produce
  exactly `[0,0,0,255]` without exceptions, after nonblack renders.
- A child red shape yields a red center while its transparent corner preserves
  the parent's blue background. Half opacity validates premultiplied transfer.
- Reusing a target for an empty child clears its old pixels; a parent exposure
  effect processes the child in linear light.
- Two nested constant-speed clips request the expected 650 ms video timestamp;
  a speed ramp requests 845 ms, including the existing 10 ms integral grid.
- A suspended independent media render holds lane zero/source access while an
  independent nested shape render completes on an explicit target. Together
  with nested media completion this exercises queue reentry and independent
  root contexts.

The existing `reentry.mjs` assertions were unchanged. Optional `COLOR_BASELINE`
and `COLOR_REPORT` environment variables select the Phase 3 baseline and a new
report location without overwriting earlier evidence. Its
[28 flat-project comparisons](2026-09-08-b5-phase4-flat-gpu.json) have nontrivial
gradient positive controls and zero channel mismatches across bypass, effects,
alpha, blending, transforms, fitting and adjustment paths. Reentry/capture checks
also pass. `node scripts/color/managed.mjs --verify` prints
`Managed color GPU invariants PASS` with its existing assertions unchanged.

## Performance and retention

The [flat paired audit](2026-09-08-b5-phase4-flat-paired.json) compares Phase 3
and the modified compositor in the same page with two warmed contexts. It uses
30 alternating warmups, then ten paired 30-frame batches, reversing execution
order per batch. Every timed frame forces completion/readback and checks pixels
and GL health. These are local end-to-end render costs, not isolated GPU timers.

| Flat workload | Modified/baseline median paired ratio | Baseline p50 ms | Modified p50 ms |
| --- | ---: | ---: | ---: |
| 4K video + 1080p title | 1.0022 | 7.5 | 7.4 |
| 4K video + 1080p video | 1.0099 | 7.4 | 7.4 |
| Three 4K stills | 1.0071 | 2.9 | 2.9 |
| Two videos + three 4K stills | 0.9882 | 9.8 | 9.6 |
| Oversized video + title | 0.9566 | 17.7 | 17.4 |

Flat workload changes range from -4.34% to +0.99% in this paired run; there is no
material flat-project regression observed here, not a universal performance
guarantee. Every warmed flat case reports zero target allocations, texture
deletes, framebuffer creates and framebuffer deletes across 300 timed frames.

Nested measurements use the same alternating paired protocol against a visually
equivalent flat 1920×1080 media/text/shape composition. Instrumentation additionally
counts texture creation, so zero deletes cannot conceal replacement textures.

| Nested levels | Flat p50 ms | Nested p50 ms | Nested p95 ms | Median paired ratio |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5.40 | 6.50 | 7.90 | 1.2068 |
| 2 | 5.20 | 7.40 | 8.30 | 1.4337 |

Each nested workload completed 300 measured frames after 30 warmups with zero
texture creates, texture deletes, target reallocations, framebuffer creates and
framebuffer deletes. Both text and shape resources are present only in the leaf
timeline. The source-pool and frame-provider retain probes also confirm the
nested video ID is retained. Nesting adds real composition/transfer work; these
ratios compare that cost separately from the flat-project regression audit.

## Full gate and source freeze

`pnpm gate` passed **9/9**: 1,065 unit tests (core 171, web 811,
desktop 72, scripts 11) and **72/72 Chromium E2E** (163.9 seconds for the E2E
step). See the [gate summary](2026-09-08-b5-phase4-gate.md) and
[complete log](2026-09-08-b5-phase4-gate-log.txt). The
[source-freeze manifest](2026-09-08-b5-phase4-source-freeze.json) has identical
before/after hashes for all **728 files**:
`47aebe54e7309c5a838027130152d438da234a2b835ce94173666b554603646e`.
Port 32119 was free both before and after the gate. No manual source edits
occurred during the full gate or E2E run. The manifest includes tracked and untracked source/config files,
excluding documentation and ignored build outputs. Port evidence uses
`lsof -ti :32119`, and the gate performs its own E2E port precondition.

## Remaining items

**Sequence color fidelity:** evaluate linear RGBA16F child targets with an
explicit color-domain contract, budgeted retained child memory and a tested
fallback. Compare flat and nested gradients/opacity ramps and child exposure
lift followed by parent reduction; report quantization, clipping, GPU time and
memory. The current RGBA8 choice and its user-visible consequences are detailed
in the design decision. The 128 MiB source cap does not constrain the separate
child target pool.


Coordinator review remains before any merge, tag or push. Sequence audio is
Phase 5 and editing UI is Phase 6; this work adds visuals only.

The coordinator identified an existing gate defect: the production build uses
`NEXT_DIST_DIR=.next-gate`, causing Next to rewrite tracked
`apps/web/next-env.d.ts` to reference `.next-gate/types/routes.d.ts`. In this full
run the later E2E dev startup restored the `.next` reference automatically and
the final before/after manifest matches. The file is excluded from this change
and is not staged or committed. A separate gate fix should restore the generated
file after a gate-only build or otherwise avoid leaving the tracked reference
changed, especially when a gate stops before E2E. This is not fixed in Phase 4.
