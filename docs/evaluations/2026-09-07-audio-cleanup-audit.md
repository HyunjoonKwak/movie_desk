# Audio cleanup — 2026-09-07

Base: fetched `origin/main` at `1ba350ba73272abf7a8b3d872c691a0d7e0271ae`.
Branch: `codex/audio-cleanup`. Renderer/effects/scopes ownership boundaries untouched.

## M1: encoder true peak moved into mixer worker

`audio-mixer-worker.ts` now applies the master gain, counts pre-clamp overloads,
clamps to ±1 into Float32 PCM, and measures that exact PCM. The exporter only
packs the returned channels into encoder frames and accumulates diagnostics.
The normalization analysis pass omits the encoder option, retaining its previous
un-normalized input and avoiding an unnecessary true-peak pass.

The generator owns a detached 2×16 Float64 ring checkpoint, index, and peak
counters. Each worker invocation restores and returns that state; only the final
chunk flushes FIR latency. No global meter/session map is involved, so concurrent
generators, cancellation and the existing retained-buffer inline retry cannot
contaminate another export. Worker-unavailable/error/timeout fallback still runs
inline, as did the existing combine fallback; normal browser exports use a Worker.
AAC synthetic priming/padding remains excluded, matching prior behavior.

Tests compare gain 1, 0.3 and 4, arbitrary 997-sample chunks, immutable checkpoints,
post-limiter PCM, Float32 normalization, overload counts and final FIR flush against
an uninterrupted meter. The exporter test uses real combine DSP and compares
reported peaks with the actual captured AudioData PCM, including 1025-sample chunks.

## Measurement

Reproduce: `node scripts/audio-cleanup-benchmark.mjs` (offline headless Chromium;
no server or port required). Browser 149.0.7827.55, 48kHz stereo, 3 trials per length,
30-second worker chunks. Raw data: [measurements](2026-09-07-audio-cleanup-measurements.json).
The baseline invokes the unchanged meter implementation on main, as in the old
exporter; the new path invokes the actual bundled mixer worker. Peak results are
exactly equal in every run.

| PCM duration | Previous main meter, median | New main result bookkeeping | New worker wall time, median | Largest 5ms timer gap |
| --- | ---: | ---: | ---: | ---: |
| 60 seconds | 204.9ms | below timer resolution (0ms) | 242.1ms | 9.8ms |
| 600 seconds | 2474.8ms | below timer resolution (0ms) | 2546.4ms | 7.1ms |

The 0ms column measures only assigning returned peak state/result, not all export
main-thread work or transfer/source-copy overhead. Worker wall time includes
source slicing, zero music allocation, transfer, bus combination, limiting and
metering; it is not a claim of lower total export time. The useful improvement is
removing the diagnostic's CPU loop from main while preserving the exact output.

## Pitch worker teardown

`useAudioPlayback` effect cleanup now calls `disposePitchWorkers`, covering editor
unmount and React refresh cleanup. Idle workers terminate immediately; an active
export worker can complete normally and is retired when it replies because its
pool generation is obsolete. Preview stop still aborts its jobs. This supersedes
the older audit's rationale for leaving the shared hook disconnected: generation
retirement already permits teardown without aborting independent exports.

## Cropped source plus padded checkpoints

Added two real-DSP worker lifecycle cases: fixed 1.37× and a 0.5–1.5× ramp, nonzero
trim, stereo 443Hz + 6011Hz content, three one-second output chunks with 100ms
padding, explicit next padded-start checkpoints, and unrelated preview renders
between export chunks. The unpadded output is sample-for-sample equal to the
uninterrupted render; the test also proves the transferred source start is cropped.
The stereo fixture deliberately has an unambiguous higher-energy reference channel.
An exploratory equal-energy/different-frequency stereo fixture chose a different
reference channel when the first source window was cropped versus full-source
rendering, an existing behavior outside this checkpoint cleanup (DSP unchanged).

## Deferred optional item

`renderClipAudio` pure-function decomposition is deferred: this cleanup changes
worker orchestration/diagnostics only and leaves the tuned DSP arithmetic and
allocation strategy untouched. Existing DSP tests and the new padded checkpoint
cases protect that boundary; extracting window/search/overlap helpers merits its
own performance comparison and review.

## Validation

Full gate results: [gate](2026-09-07-audio-cleanup-gate.md).
Initial attempts stopped on type-only import and test implicit-any lint rules, corrected before the final rerun.
Port 32119 was checked with `lsof` before each full gate attempt; initially no listener.
One run passed the first eight stages but stopped before E2E because another gate
acquired the port meanwhile; its process was left untouched and scheduling was
requested from the coordinator.

Final full rerun: **9/9 PASS**, unit **883** (core153/web647/desktop72/scripts11),
Chromium E2E **61/61 PASS** in 126.4s. The coordinator reserved the port for
this run; `lsof -ti :32119` confirmed no listener before and after it.
