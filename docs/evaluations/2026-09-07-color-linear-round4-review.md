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

Insertion still reserves weighted capacity before allocation, and eviction
still deletes both the texture and framebuffer. Spatial scaling retains RGBA16F
8-byte/texel accounting and aspect ratio. Oversized sources use `LINEAR` sampling
without mipmaps, so downscaling can introduce aliasing as well as softness.

The benchmark accepts `process.argv[2]` as its comparison revision, defaulting to
`f4adad6`, and records the same resolved argument in its JSON. For this review use
`node scripts/color/cache-memory.mjs d94481c`. Text and shape renderers are real
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

## Measured working sets and memory arithmetic

[Raw round 4 JSON](2026-09-07-color-cache-memory-round4.json), Apple M4 / ANGLE
Metal, half-float. The baseline argument is `d94481c`; the original round 3 JSON
is preserved separately. These are instrumented wall times, not GPU timestamp
queries, and exclude decoding. No other benchmark or E2E command ran concurrently.

| Same-frame working set | Mean ms, before → after | p95 ms, before → after | Target allocations in 180 frames, before → after | Allocated target bytes, before → after |
| --- | ---: | ---: | ---: | ---: |
| 4K video + 1080p title | 13.210 → 7.162 | 18.4 → 10.0 | 360 → 0 | 14,929,920,000 → 0 |
| 4K video + 1080p video | 12.664 → 7.051 | 16.9 → 9.7 | 360 → 0 | 14,929,920,000 → 0 |
| Three 4K stills | 33.337 → 2.021 | 40.0 → 5.1 | 540 → 0 | 35,831,808,000 → 0 |
| 6000×4000 video + 1080p title | 19.586 → 14.913 | 25.8 → 22.2 | 360 → 0 | 15,060,539,520 → 0 |

Texture deletions and framebuffer creations/deletions equal the before allocation
counts and are all zero after warmup in the new implementation. Both title cases
verify visible bright glyph pixels on the real rasterized title. 4K+1080p source
cache storage is exactly 82,944,000 bytes after the repair; the three-still image
cache is 199,065,600 bytes. The oversized-video + title cache uses 150,776,832 bytes.
The required title workload improves in all three batch means (11.128/14.388/14.117
ms before, 6.320/7.478/7.697 ms after); no frame-time regression is observed in this
measurement. Raw video/title uploads still occur each frame and shrink afterward;
zero target allocation does not mean zero raw texture upload/storage activity.

| 1000 distinct 4K still traversal metric | d94481c | Round 4 |
| --- | ---: | ---: |
| Retained tracked texture bytes | 182,476,896 | 248,832,096 |
| Peak tracked texture bytes | 215,654,492 | 282,009,692 |
| Cached image bytes | 132,710,400 | 199,065,600 |
| Heap before GC-controlled traversal | 2,238,466 | 2,241,122 |
| Heap after traversal + GC | 2,613,001 | 2,616,281 |
| Heap growth | 374,535 | 375,159 |
| Traversal wall time, ms | 11,047.9 | 11,487.2 |
| Tracked texture bytes / framebuffers after dispose | 0 / 0 | 0 / 0 |

The extra retained 4K still accounts exactly for both storage increases:
248,832,096 − 182,476,896 = 282,009,692 − 215,654,492 = **66,355,200** bytes.
After retained storage decomposes as three 4K targets (199,065,600), project-sized
managed working storage (49,766,400), and 24 one-pixel RGBA8 uploads (96).
Peak adds one 4K RGBA8 upload less its prior 4-byte placeholder:
248,832,096 + 33,177,600 − 4 = **282,009,692**. Heap after traversal differs by
3,280 bytes. Sequential one-shot traversal is 4.0% slower in this single run;
it does not benefit from retaining a third never-revisited image. We make no
sequential throughput improvement claim. The same-frame title regression is
resolved at the measured memory cost, within explicit cache ceilings.

## Final verification and reproduction results

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
