# First-sound regression repair

Base: `origin/main` fetched and verified at `59330f1`.
Branch: `codex/b3-first-sound`.

## Change

Playback constructs the mixer with metering disabled and schedules the initial audio before starting worklet loading. On completion, the same graph gains zero-output measurement taps at track, bus, and master outputs. Audible connections, source schedules, and gain automation remain intact; route changes disconnect only the previous audible destination, preserving the measurement tap.

A separate meter generation plus graph identity rejects callbacks after stop/replay without rejecting a valid callback when pitch rendering replaces sources within the same playback. The existing `live=false` waveform estimate remains active until attachment; unavailable modules retain the estimate. Disposed graphs refuse attachment and close worklet ports.

## Measurements

All local runs used macOS and Playwright Chromium. The existing `firstSoundMs` metric measures elapsed time through the first `AudioBufferSourceNode.start()` call, rather than acoustic hardware latency. The 500ms assertion is unchanged.

| Run | Injected module delay | firstSoundMs | Module ready |
| --- | ---: | ---: | ---: |
| Original main, local | none | 210.27ms | not instrumented |
| Fixed, targeted E2E | 0ms | 66.18ms | 75.85ms |
| Fixed, targeted E2E | 1000ms | 63.13ms | 1066.25ms |

The coordinator supplied original GitHub runner failures of 546.19 / 576.78 / 847.98ms; those are CI evidence, not locally reproduced measurements. The delayed E2E retains the 500ms budget, waits for module completion, and verifies first sound preceded it. Unit tests independently hold module completion for 300ms and assert source scheduling happens at time zero, with no additional source starts/stops on attachment and no attachment after stop.

## Validation

- Targeted pitch and audio mixer E2E: 5 passed, including a nonzero measured master level during playback.
- Graph tests verify measurement attachment adds only taps, never disconnects audible routes, never connects meter outputs to audible destinations, and remains idempotent after attachment/disposal.
- Worklet tests cover zero-output processing; existing stereo and LUFS coverage remains.
- Existing meter fallback test retains the estimate label and nonzero waveform estimate.
- Port 32119 was checked with `lsof` before browser runs and the full release gate; no listener was present.
- Full gate results are recorded below after completion.

Local raw logs: `/tmp/b3-first-sound-before.log`, `/tmp/b3-first-sound-after.log`, `/tmp/b3-first-sound-gate.log`.

## Final full release gate

`pnpm gate`: **PASS**, all 9 steps, no skips.

- Desktop: 72 tests passed.
- Core: 153 tests passed (20 files).
- Web: 642 tests passed (125 files), including graph, fallback, worklet and delayed startup coverage.
- Gate scripts: 11 tests passed.
- Total unit/script tests: 878 passed.
- Browser E2E: 61 passed, 0 failed (125.9s), including all three audio mixer cases.
- OSV: 167 production packages checked, no known vulnerabilities.
- Install, version policy, lint, typecheck, production build and Chromium install passed.
- Full-gate first sound: **76.23ms** at 0ms injected delay; **63.06ms** at 1000ms injected delay (module ready 1066.29ms).

An initial gate invocation stopped on the new optional-meter cleanup's `noDelete` lint rule; cleanup was corrected to assign `undefined`, then the complete gate above passed. The existing untracked `protected-test-mocks.patch` was left untouched; no push or main merge was performed.
