# B′5 Phase 3 — compositor frame ownership

Completed validation on 2026-09-08 KST (2026-09-07 UTC), on
`HyunjoonKwak/codex-b5-phase3`, based on main `84a26767d60bb58ddcdb05861492abacb41b13c9`.
The branch began with an empty diff against origin/main. No nested sequence
rendering, merge, tag or push is included.

## Result

The compositor now accepts an optional target and numeric playhead. Every
visibility, text-animation, keyframe, transition and source-time path receives
the frame's captured playhead. Defaults retain screen rendering and the project
snapshot. Existing callers no longer install a mutable live playhead closure.

Frame contexts own depth-lane PingPong instances and scratch leases keyed by
(depth lane, role), with dimensions attached to each entry. A live entry cannot
be resized or destroyed by another request; only idle variants retire. Child
presentation FBOs have their own pool and transparent clear, while the root
keeps opaque black. Source normalization slots include the depth lane, and
immutable image cache keys include source identity/currentSrc version.

A clip holds source/image/raw/mask leases until composition, including awaits;
frame cleanup releases them on failure or cancellation. Reservations preserve
both byte and entry caps, refuse pressure atomically and never evict pinned
parents. Retain/dispose defer destruction until the final borrower releases.
Media source acquisition, seek, upload and segmentation share a narrow queue
so overlapping renders cannot race a mutable media element's timestamp.

Alpha promotion happens before scene initialization. Upload no longer clears
an in-progress scene. Explicit-target GPU sections restore independent
read/draw FBO bindings and viewport synchronously; no binding snapshot crosses
an await. Default screen rendering retains ownership of canvas GL state and
avoids per-layer synchronous state queries. Export and scopes accept explicit
readback targets; export failure paths restore bindings and recycle the slot.

See the [ownership decision](../decisions/2026-09-07-compositor-reentry.md) for
lease lifetimes, role keys and the mandatory Phase 4 rule: **never call a nested
renderFrame inside withSource**. Logical graph ancestry/depth validation remains
Phase 4 work; invocation lanes are resource ownership, not a traversal algorithm.

## Pixel and lifetime evidence

- [GPU comparison](2026-09-07-b5-phase3-gpu.json): 28 baseline/modified scenarios,
  each comparing all 147,456 channels, with zero differences and zero maximum
  delta. Cases include opaque bypass, each non-LUT effect with passes, alpha
  promotion, layered blend modes, fit/transform and adjustment layers. Positive
  controls check nonempty varying RGB, valid compositor/context state, and
  completed readback. Grain uses the same fixed time for both implementations.
- Four new Chromium cases cover native precision and forced sRGB8, each with
  normal and constrained source budgets. A parent suspends **after upload** in
  segmentation; a child at a different aspect renders while its texture remains
  leased. The parent and next screen frame stay identical. Under pressure the
  child returns transparent black without throwing or evicting the parent.
  Split bindings, viewport, transparency, explicit playhead visibility and
  synchronous BT.709 capture are checked too.
- Seven new unit tests cover weighted/entry reservations, deferred retire and
  disposal, idempotent release, depth/role/size isolation, asynchronous worker
  capture binding restoration, failed-read slot recycling and synchronous
  failure restoration. Existing unit/E2E test files were not edited.
- `COLOR_GPU=metal node scripts/color/managed.mjs --verify` passed. With explicit
  coordinator approval, the private audit fixture received a context adapter;
  **all historical calls, assertions and expected pixel values are unchanged**.
  [Manual-check output](2026-09-07-b5-phase3-manual-checks.txt).

The initial finish-only timing experiment was not a valid measurement of GPU
completion. It was replaced with forced readPixels completion, context-health
checks and draw counts; its implausible values are not retained as performance
evidence. The final 1080p exposure timing submits 240 draws per implementation
and reports p50 **3.0 / 2.9 ms**, p95 **7.5 / 7.3 ms** (baseline / modified),
with four warmup target/FBO allocations each and zero steady-state allocations.

## Memory and frame-time measurements

The existing cache-memory workloads were retained, with added black-frame
checks, a combined two-video/three-still workload, output-path selection and
reverse-order support. No existing cache-thrashing, pixel or leak assertions
were weakened.

[Forward](2026-09-07-b5-phase3-memory.json) and
[reverse](2026-09-07-b5-phase3-memory-reverse.json) runs both reported:

- Baseline: zero black frames among 2,050 checked frames per run.
- Modified: zero black frames among 2,070 checked frames per run, including the
  existing modified-only 20-step oversize/resolution stress.
- All five warmed working sets: zero target allocations, texture deletions,
  framebuffer creations and framebuffer deletions.
- Retained texture bytes: **248,832,096**, identical for both implementations
  in both orders. After disposal: zero texture bytes and zero framebuffers.
- Source/image byte limits remain unchanged and shared across lanes.

**Those two whole-run timing results give opposite conclusions and cannot
resolve implementation cost.** For example, three stills measure 2.9/4.6 ms in
forward order, but 3.2/2.9 ms when order is reversed; the mixed workload changes
from 11.1/16.6 to 14.3/9.9 ms. Neither order was selected as the performance
verdict. These files are memory/black-frame evidence; their timing is dominated
by run-order effects.

The [paired measurement](2026-09-07-b5-phase3-paired.json) uses two warmed
contexts on the same page, 30 alternating warmups, then ten paired batches of
30 frames with implementation order reversed every batch. Every frame forces
readback and verifies neutral output/context health. These are 300 measured
frames per implementation per workload, using actual source transfer, text
rasterization, effects and composition; source decode/I/O is excluded.

| Workload | Baseline p50/p95 ms | Modified p50/p95 ms | Median paired batch ratio |
| --- | ---: | ---: | ---: |
| 4K video + 1080p title | 8.5 / 10.3 | 8.4 / 10.2 | 0.9892 |
| 4K video + 1080p video | 8.2 / 9.9 | 8.2 / 9.4 | 0.9798 |
| Three 4K stills | 3.1 / 4.3 | 3.2 / 4.4 | 1.0167 |
| Two videos + three 4K stills | 10.5 / 12.0 | 10.6 / 12.2 | 1.0189 |
| Oversized video + 1080p title | 24.6 / 35.1 | 25.3 / 40.2 | 1.0325 |

The large initial still regression is gone. The remaining measured paired
median overhead is **1.7%, 1.9% and 3.3%** in the last three workloads; the
oversized workload also has a higher measured p95. These are implicit-screen
renders, so explicit-target GL save/restore is not charged here. Added work is
frame/lease/retention bookkeeping and source-queue boundaries; this experiment
does not separately attribute their individual shares. The coordinator
accepted this measured cost for the reentry foundation.

A [supplemental bypass measurement](2026-09-07-b5-phase3-bypass.json) uses the
same paired protocol with native-size opaque I420 video and immutable still
inputs, without effects. Video p50/p95 is **2.1/2.5 → 1.8/2.3 ms** (paired ratio
0.8985); still is **0.9/1.1 → 0.8/0.9 ms** (ratio 0.8222). Both have zero black
frames and zero steady-state allocations/deletions. Thus the common single-clip
bypass shows no regression in this local run; it is not a universal speedup
claim. The [standalone runner](2026-09-07-b5-phase3-bypass-runner.txt) can be copied
to a `.mjs` file and run from the repository root. It was run after E2E using an
external temporary file, without modifying the validated source tree.

## Full release gate and frozen-source proof

`pnpm install --offline --frozen-lockfile` passed separately.
`pnpm gate --report docs/evaluations/2026-09-07-b5-phase3-gate.md` passed **9/9**:
install, version policy, lint, typecheck, unit tests, OSV audit, production build,
Chromium installation and full browser E2E.

- Core Vitest: **171**; web Vitest: **811**, including i18n catalogue parity;
  desktop: **72**; script tests: **11** — **1,065 total**.
- Chromium: **72/72**, **2.8 minutes**, with no retries reported.
- OSV: 167 production packages checked, no known vulnerabilities reported.
- Lint passed with 14 pre-existing console warnings in unchanged web helper
  scripts. Build succeeded with the existing MediaPipe dynamic-dependency
  warning; terminal logs also contain the NO_COLOR/FORCE_COLOR warning.
- All **727 non-document source/configuration files** had identical hashes
  before and after the full gate. Aggregate SHA-256:
  `3b76ff738b50685a7a56f47babb740d16f5f54ca08b89fee4b958ed999dffc50`.
  Port 32119 was free before and after. No source file was edited during E2E.

Evidence: [gate table](2026-09-07-b5-phase3-gate.md),
[full output including E2E cases](2026-09-07-b5-phase3-gate-log.txt),
[source-freeze record](2026-09-07-b5-phase3-source-freeze.json).
The work-order section is in [docs/07](../07-work-order.md).

## Decisions that needed review

1. Depth keys alone do not protect parents: leases, active-frame retention and
   async media ownership were included in scope after coordinator review.
2. Frame-wide leases would unnecessarily retain already-consumed clips;
   clip-lifetime leases preserve the ordinary working-set budget.
3. Saving GL state around an entire async render is unsafe because completion
   order need not be LIFO. Synchronous sections restore explicit targets only;
   keeping the old default canvas ownership removes the large query overhead.
4. Source serialization prevents mutable seeks racing. A global lock-held
   rejection would reject legitimate overlap, so the Phase 4 no-nested-render
   invariant is explicit in code and the decision document instead.
5. A private audit adapter was approved instead of leaving the deepest existing
   color tool broken. Its historical assertions were preserved verbatim.
6. Whole-run memory timing proved order-sensitive. Paired alternating batches,
   including honest residual overhead, replaced a one-sided performance claim.
