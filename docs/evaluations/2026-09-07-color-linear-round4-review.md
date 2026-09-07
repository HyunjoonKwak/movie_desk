# B’4b round 4 — frame working sets and sampler investigation

Review base: `d94481c`. This record supplements the historical round 3 numbers in
[the color audit](2026-09-07-color-audit.md).

## Frame working-set repair

The 64 MiB source cache could not hold a 4K RGBA16F source (66,355,200 bytes)
and a 1920×1080 title (16,588,800 bytes): 82,944,000 bytes total. Alternating
these two resolutions evicted both targets on every frame. The image cache’s
128 MiB similarly held only two of three 4K stills.

Both caches now have a 192 MiB (201,326,592 byte) ceiling, 384 MiB
(402,653,184 bytes) per Compositor combined. A single managed target is capped
at 128 MiB (134,217,728 bytes), leaving 67,108,864 bytes for another target:
a 4K project target needs 66,355,200 bytes. Three native 4K RGBA16F images use
199,065,600 bytes and fit the independent image cache. This bounds the tested
working sets; arbitrarily many simultaneously visible images/resolutions can
still exceed finite caches. Project sizes above 4K and more than three large
stills are not a no-thrashing guarantee. Both preview and export can hold their
own caches; scene, scratch, ping-pong, current raw upload, decoder/canvas backing
and driver overhead remain outside these bounds.

### Hardware assumption and concurrent preview/export

The 384 MiB cache policy assumes, as an engineering support floor for up-to-4K
work, a GPU with at least **2 GiB dedicated VRAM** and **8 GiB system RAM**, or
an integrated/unified-memory system with at least **8 GiB shared memory** and
roughly **2 GiB available to graphics workloads**. This is a planning assumption,
not a measured minimum-spec certification; the benchmark only tested Apple M4.
Other applications and OS reservations reduce available memory.

Export creates a second Compositor (`export/exporter.ts`) while the preview
Compositor (`preview/preview-viewport.tsx`) remains alive. Therefore the worst
concurrent **cache ceiling is 768 MiB (805,306,368 bytes)**, before any excluded
storage. Doubling the round 4 single-compositor tracked traversal peaks gives
**431,308,984 → 564,019,384 bytes (431.3 → 564.0 MB)**, an estimate for two
identical workloads, not a concurrent measurement or overall process limit.
The true worst-case total is not bounded by these caches: scene/scratch/ping-pong,
raw uploads, decoded frames, Canvas/ImageBitmap backing, driver overhead and
other browser/OS memory add to the 768 MiB cache ceiling. Four-K export targets
can also be larger than this benchmark's 1080p project targets.

Below that floor or under competing memory pressure, smooth preview and export
throughput are expected to degrade first (stalls, dropped preview frames, and
on unified memory, compression/swap); allocation failure or WebGL context loss
may follow, and drivers need not fail in that order. Cache ceilings do not adapt
to available hardware memory. Oversized-source downscaling already reduces
fine detail and may alias regardless of hardware; a visible quality notice is
warranted when scaling activates because exported pixels are affected, but its
UI implementation is deferred from this documentation-only follow-up.

Insertion still reserves weighted capacity before allocation, and eviction
still deletes both the texture and framebuffer. Spatial scaling retains RGBA16F
8-byte/texel accounting and aspect ratio. Oversized sources use `LINEAR` sampling
without mipmaps, so downscaling can introduce aliasing as well as softness.

The benchmark accepts `process.argv[2]` as its comparison revision, defaulting to
main-reachable `0e6804a`, and records its resolved full commit hash in JSON.
**Rule: bench default baselines must be reachable from main.** Reproduce with
`node scripts/color/cache-memory.mjs` (or explicitly pass `0e6804a`). The main
baseline predates managed color targets; it is measured as RGBA8/unmanaged with
absent managed-cache fields reported as null, while the after row requires
half-float. This comparison includes the color-pipeline change, so it does not
isolate the round 4 cache repair. The earlier branch-only `d94481c` comparison
is historical evidence only; the checked-in JSON is regenerated from main. Text and shape renderers are real
modules now; only media acquisition/provider and unrelated AI/LUT boundaries
are fixtures. Timestamped real VideoFrames exercise video uploads; decode time
is deliberately excluded. Each simultaneous working set uses 30 warmup frames
then three 60-frame batches, with `gl.finish()` on each frame. Texture allocation
bytes/counts, deletes, FBO creates/deletes and timing distributions are recorded;
the after implementation rejects any steady-state target/FBO churn. Scenarios
cover 4K video + real 1080p title, 4K + 1080p videos, three 4K stills, and a
6000×4000 video + title. The 1000-image traversal and oversized/resolution-churn
checks remain, with texture bytes required to return to zero after dispose.

## Small review corrections

Both audio export mocks explicitly export `hasConflictingBt709Output: () =>
false`; they no longer rely on short-circuiting to hide an undefined mock export.
The exporter comment documents the existing preflight-only missing-metadata
latch; later explicit conflicting metadata still takes the error path.

## Sampler failure: open, not attributed to the budget

The coordinator reported one failure in three full-suite review runs, the last
of 64 tests, followed by an isolated pass; Claude also reported two subsequent
full-suite 64/64 passes. The only surviving original failure log is:

```text
1 failed
  [chromium] › e2e/webcodecs-sampler.spec.ts:25:1 › analysis decodes an MP4 through a real VideoDecoder
63 passed (3.1m)
```

The coordinator confirmed the detailed assertion and error-context were not
retained, and the validation worktree was removed. We cannot reconstruct which
assertion failed or claim a GPU error from that summary. The spec waits for the
`1/1` analysis UI before reading configure/frame counters; therefore even a
failure in this decoder-named test does not establish a decoder failure.

Code-path evidence: `autoedit/sampler.ts` invokes `renderer/frame-sampler.ts`,
which uses 160×90 Canvas2D output and VideoDecoder, not Compositor source/image
caches. `ffprobe` reports the fixture as VP9, 320×180. Compositor cache eviction
is local to that instance and clears textures/FBOs on dispose. Playwright uses
one worker, a separate page/context per test, and a fresh browser per command;
the final test still follows 63 tests in the same suite/browser, so shared GPU
process/resource pressure remains a plausible indirect factor. A passing repeat
cannot eliminate that hypothesis. Analysis completion also includes optional
face-model initialization/scoring and audio sampling after video sampling; the
missing original assertion prevents narrowing that stage.

Reproduction method: before touching application code, run the full suite three
times at d94481c source/image budgets (64/128 MiB), then run three full suites
with the new budgets. Use local defaults: one Chromium worker, list reporter,
CI unset (zero retries), no spec filtering, same port 32119. Before every command,
run `lsof -nP -iTCP:32119 -sTCP:LISTEN` and refuse an occupied port. Save full
stdout/stderr and copy test-results after every run before the next can replace
it. No audio code, sampler code, assertion, timeout, or retry policy is changed.

## Reproducible main-baseline measurements (round 5)

[Raw JSON](2026-09-07-color-cache-memory-round4.json) was regenerated in round 5
using default `node scripts/color/cache-memory.mjs`, baseline
`0e6804a84fc81eb4a5aeaa9f984e37ad7bffd281` (verified reachable from main),
Apple M4 / ANGLE Metal. No other benchmark or E2E ran concurrently.
The historical round 4 branch-to-branch result (title 13.210 → 7.162 ms,
360 → 0 allocations) is superseded in this artifact by a reproducible comparison
against main; it must not be read as the current JSON's before row.
Main uses RGBA8 encoded-space rendering without managed caches, whereas after
uses linear half-float rendering. These timings compare different color paths,
not just cache budgets; the video/title workloads are slower than main.

| Same-frame working set | Mean ms, main → after | p95 ms, main → after | Target allocations in 180 frames, main → after |
| --- | ---: | ---: | ---: |
| 4k-video-1080p-title | 1.858 → 6.608 | 4.1 → 9.4 | 0 → 0 |
| 4k-video-1080p-video | 1.920 → 6.761 | 3.8 → 9.6 | 0 → 0 |
| three-4k-stills | 4.170 → 1.919 | 6.6 → 5.0 | 0 → 0 |
| oversized-video-1080p-title | 4.036 → 14.142 | 6.5 → 19.2 | 0 → 0 |

All after working sets have zero target allocations, texture deletes, and FBO
creates/deletes following warmup. Both title cases assert visible real glyphs.
4K+1080p managed source storage is 82,944,000 bytes, three-still image storage is
199,065,600 bytes, and oversized-video + title storage is 150,776,832 bytes.
Target allocation counts include nontrivial RGBA8 targets in the old renderer
and RGBA16F targets in the new renderer; raw 1×1 upload resets are excluded.

| 1000 distinct 4K still traversal metric | Main | After |
| --- | ---: | ---: |
| Retained tracked texture bytes | 796,262,400 | 248,832,096 |
| Peak tracked texture bytes | 796,262,400 | 282,009,692 |
| Cached managed image bytes (null = unavailable) | null | 199,065,600 |
| Heap before GC-controlled traversal | 2,068,926 | 2,245,282 |
| Heap after traversal + GC | 2,348,889 | 2,619,769 |
| Traversal wall time, ms | 3,293.1 | 11,052.7 |
| Tracked texture bytes / framebuffers after dispose | 0 / 0 | 0 / 0 |

The main renderer retains 24 raw 4K textures (796,262,400 bytes). After retained
storage is three managed 4K targets (199,065,600), project-sized working storage
(49,766,400), and 24 one-pixel RGBA8 uploads (96), totaling 248,832,096 bytes.
One live 4K upload minus its placeholder adds 33,177,596 bytes to reach the
282,009,692-byte tracked peak. This excludes decoder/canvas and driver storage,
and is a sequential traversal rather than an import/OPFS measurement.

## Historical round 4 verification and reproduction results

`pnpm gate --report docs/evaluations/2026-09-07-color-linear-round4-gate.md`:
**9/9 PASS** ([gate table](2026-09-07-color-linear-round4-gate.md)), core **155**,
web **709**, desktop **72**, scripts **11** — **947** unit tests. Typecheck zero
errors, Biome clean, production build passes, OSV **167** production packages
with no known vulnerabilities. Gate E2E step wall time: **183.0 seconds**.

| Budgets, source/image MiB | Full-suite run | Outcome (zero retries) | Last sampler duration |
| --- | ---: | --- | ---: |
| 64/128, d94481c application code | 1 | 64/64 PASS, 3.1m | 886ms |
| 64/128, d94481c application code | 2 | 64/64 PASS, 3.0m | 1.0s |
| 64/128, d94481c application code | 3 | 64/64 PASS, 3.0m | 842ms |
| 192/192, round 4 (gate) | 1 | 64/64 PASS, 3.0m | 843ms |
| 192/192, round 4 | 2 | 64/64 PASS, 3.1m | 875ms |
| 192/192, round 4 | 3 | 64/64 PASS, 3.0m | 845ms |

All **384/384** test invocations passed. Each sampler was test 64, after all 63
preceding tests, preserving the suspected order/resource-pressure condition.
[Full six-run E2E logs and port prechecks](2026-09-07-color-round4-e2e.txt) are
checked in; source captures and copied test-results are also at
`/tmp/color-round4-before` and `/tmp/color-round4-after`. All six lsof checks
returned no listener (with an unrelated inaccessible Time Machine SMB mount
warning); no existing server was reused or stopped. Current runs generated no
failure screenshot/video/error-context because no test failed.

**Conclusion: not reproduced; cause remains open.** The six-run comparison
finds no evidence that the cache-budget change causes this intermittent failure,
but does not prove independence or rule out rare shared GPU/resource pressure.
The issue remains registered in docs/07, with the next reproduction required to
capture the assertion, analysis stage, decoder events and GPU/context-loss
signals together. Neither an isolated pass nor these repeated passes close it.
The existing B’3 audio-meter race also remains open; no audio implementation or
E2E test was changed. Final memory arithmetic assertions, benchmark Biome check,
and diff whitespace check passed after the report path was separated from the
historical round 3 artifact.
