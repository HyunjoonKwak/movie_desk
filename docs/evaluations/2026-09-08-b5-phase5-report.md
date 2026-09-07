# B′5 Phase 5 audio evaluation — 2026-09-08

Base: `origin/main` after Phase 4 (`46d32a9`), branch
`HyunjoonKwak/codex-b5-phase5`. The initial diff against origin/main was empty.
No existing unit or E2E assertions were changed. No storage or i18n fields changed.

## Implementation and product choices

The shared core sequence plan preserves stereo boundaries, local solos and
ordered track pans. Export recursively streams child PCM; preview uses that
same evaluator for folded sources and connects them to the parent live graph.
Stopped/scrubbing levels traverse the same plan. Child changes invalidate
scheduled audio. Invalid targets are silent, including cyclic subtrees that
also contain valid media.

The coordinator resolved two design questions during implementation:

- Child tracks apply local controls only. Project bus/master apply at the root
  containing track, superseding Phase 0's proposed scoped child bus processing.
- Sequence boundaries use varispeed now. Child media's opt-in pitch preservation
  remains independent. Sequence pitch storage and its UI belong together in
  Phase 6; the documented future transform order is child mixdown then B′2.

See [the decision](../decisions/2026-09-08-sequence-audio.md).

## Correctness evidence

New tests: `apps/web/src/export/__tests__/audio-sequence.test.ts` and
`apps/web/src/preview/__tests__/audio-sequence-playback.test.ts`.

- Flat equivalence compares every sample of both channels after nonzero child
  placement, parent placement/trim and interval clipping. Additional comparisons
  cover repeated instances, local child solo, the eight-level valid limit, ordered
  child/parent pans and volume replacement, and unclipped child mixdown.
- PCM comparisons allow absolute error below `1e-7` (about one Float32 epsilon
  at unity, or −140 dBFS). This accounts for Float32 rounding from an extra
  intermediate sum/multiply, not timing drift. Benchmark fixtures have **exactly
  zero** sample error at both tested depths.
- `sequenceAudioTime` produces **650 ms** for trim/constant speed and **845 ms**
  for the Phase 4 linear ramp. Encoded timestamp PCM also tests the actual
  resampling grid across arbitrary chunks, fractional offsets, single-key speed
  tracks and reverse. Mapping assertions use six decimal places for Float32
  encoded time. Ramp and pitch chunk comparisons allow `1e-6` (−120 dBFS).
- Parent mute and non-solo exclusion produce all-zero PCM and meter estimates.
  Parent −6 dB gain produces ×0.501187. Child solo is local. Same-bus −6 dB
  produces ×0.501187 once, and a child-only bus mute does not bypass root policy.
- Pitch preservation uses the real core B′2 DSP through a mocked worker transport.
  The child 440 Hz tone at preserved 2× followed by parent 2× varispeed measures
  **880 Hz** by positive zero crossings over 0.8 seconds. It also matches the
  explicitly ordered two-stage PCM and retains continuity across 137/1000 ms
  parent chunking. Browser worker transport remains covered by existing E2E.
- Preview scheduling uses the real nested mixer with synthetic AudioContext
  buffers and records the graph destination, stereo amplitude, rate, start offset
  and duration. Two additional tests verify generation-based cancellation:
  superseded playback cannot stop a replacement, and current failures propagate.
  The completed source enters the parent track once, at rate 1
  after its sequence speed and volume were already rendered.
- A constant equal-channel PCM fixture compares both fallback master-meter paths
  against actual nested mixer peaks with opposing child/parent pans, volume
  replacement and nonzero track/bus/master gains. Absolute error is below `1e-7`
  for Float32 intermediate rounding. This is a routing-parity check for a signal
  representable by scalar waveform envelopes, not a claim of phase/effects
  accuracy for the existing fallback estimator. Stereo peaks are retained until
  root panning; child-only changes invalidate the strip cache.
- Cycle, self-reference, missing target and excessive depth yield no prepared
  contribution, all-zero PCM and zero envelope. Each test has a two-second test
  timeout. The focused suite is additionally launched by `subprocess.run` with
  a **60-second hard process timeout**, so a synchronous infinite loop cannot
  escape the test-runner timeout and freeze the harness.

Reproduce focused checks:

```sh
pnpm --filter @movie-desk/web exec vitest run \
  src/export/__tests__/audio-sequence.test.ts \
  src/preview/__tests__/audio-sequence-playback.test.ts
```

## Alternating paired performance

[Raw timings and all 600 pairs](2026-09-08-b5-phase5-audio-performance.json).
Each depth has 30 warmup pairs and 300 measured pairs; order alternates
flat→nested / nested→flat. Both use one second of identical 48 kHz stereo PCM.
Time covers mixer construction, decoding mock, recursive PCM export and disposal.
It excludes actual codec decoding, disk I/O and browser worker transfer, so these
are local PCM mixer costs rather than end-to-end MP4 export guarantees.

| Child levels | Flat p50 ms | Nested p50 ms | Nested p95 ms | Median paired ratio | Max sample error |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.0002 | 1.9807 | 2.7178 | 1.9751× | 0 |
| 2 | 0.9885 | 2.8950 | 3.5346 | 2.9352× | 0 |

The extra mixdown/resampling per boundary has measurable cost. The measurement
uses synthetic decoded inputs and is not a claim that real nested exports are
uniformly 2–3× slower. Source windows, decode retention and large speed factors
are explicit memory costs described in the decision.

Reproduce the benchmark (absolute output path):

```sh
B5_AUDIO_BENCHMARK="$PWD/docs/evaluations/2026-09-08-b5-phase5-audio-performance.json" \
  pnpm --filter @movie-desk/web exec vitest run src/export/__tests__/audio-sequence.test.ts
```

## Full gate

The initial gate stopped at two existing meter tests; their assertions stayed
unchanged. The fallback traversal now tolerates stale root duration and exposes
a pre-root source query because existing strips own root routing. The
[initial failed gate](2026-09-08-b5-phase5-initial-gate.md) and its
[source freeze](2026-09-08-b5-phase5-initial-source-freeze.json) are preserved.
The [intermediate gate](2026-09-08-b5-phase5-intermediate-gate.md) passed 9/9 and
72/72 Chromium tests with an unchanged source manifest. Read-only review during
that run identified the cancellation race; all follow-up source changes waited
until it completed. The final gate below covers the added parity/cancellation
checks and their fixes, with a fresh source freeze.

The final `pnpm gate` passed **9/9**: **1,083 unit tests** (core 171,
web 829, desktop 72, scripts 11), plus **72/72 Chromium E2E** in 165.0 seconds.
One opt-in performance test is skipped in the ordinary gate and passed separately
in the recorded benchmark run. See the [final gate summary](2026-09-08-b5-phase5-gate.md),
[complete log](2026-09-08-b5-phase5-gate-log.txt), and
[focused hard-timeout run](2026-09-08-b5-phase5-focused-tests.txt).

The [final source-freeze manifest](2026-09-08-b5-phase5-source-freeze.json) has
identical before/after hashes for **731 source/config files**:
`cbb73eb5dab873c6bd14583a309d8b7f23cd27107d38bc12fb4e2c3c38577a1b`.
Port 32119 was unoccupied before and after the gate. No source edits occurred
during any full E2E run. `next-env.d.ts` is unchanged and excluded from staging.
Existing unit/E2E assertions were not modified.
Coordinator review remains before merge, tag or push. Sequence pitch toggle and
child editing UI remain Phase 6 scope.
