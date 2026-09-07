# CI color verification repair

Base: `origin/main 8f028cf836d5acbf874f24a20fc55ee5de660f06` after explicit fetch.
Branch: `codex/ci-color-verify`. Product code is unchanged.

## Findings

The old restoration E2E awaited `promisify(execFile)(node, [managed.mjs, --verify])`.
Playwright printed the rejected command without the captured child stdout/stderr.
That audit launches another Chromium process and exercises many renderers, float
readback, unbounded highlight retention, effects, and performance loops. In
particular its unconditional float readback/gain and unclipped highlight assertions
require half-float targets; they are not valid SRGB8 restoration expectations.
The reported CI message cannot identify which internal assertion/probe failed:
SwiftShader target instability remains a plausible mechanism, not a proven stack
trace. The previous reported `Color target is not renderable` is consistent with
`allocateTarget` rejecting an incomplete framebuffer.

## Change

Remove the subprocess from E2E entirely. `node scripts/color/managed.mjs --verify`
remains a **manual GPU audit requiring renderable half-float targets**, with direct
stdout/stderr, outside browser E2E and outside the portable release gate. Its
precision/highlight/performance coverage has not been silently reclassified as
portable UI coverage.

Run restoration in the existing Playwright page, once with available precision
(half-float OR SRGB8) and once with `EXT_color_buffer_float` disabled by a test-only
hook. Add an actual Invert effect to a gray still and assert the resulting encoded
pixel 137 before and after context loss/restoration (SRGB8 alone allows one
code of intermediate quantization error). Observe real, non-probe color
texture allocations on the preview canvas; require a new allocation after loss,
a restoration event, a healthy context, and resumed effect output. Test-injected
`data-color-*` attributes are instrumentation, not a claimed product API.

SRGB8 is a valid software-renderer outcome: require the app's actual `precision`
warning and reduced-precision hint; half-float must not emit that warning. Dismiss
old warnings and clear observed events at loss so stale state cannot satisfy the
restored assertion. Keep the separate synthetic source `approximation` event/hint
contract (filename plus SDR approximation text); do not confuse this with GPU
precision reporting. Reject `unsupported` on both supported paths.

Failures print browser warnings/errors and observed target state directly in CI,
and attach the same JSON as `color-context-diagnostics`. No skip, retry increase,
product changes, or second browser was introduced.

## Validation

- Unmodified baseline: full E2E **67/67 PASS**, browser gate step **235.6s**;
  old restoration test **35.1s**. This local run did not reproduce the original
  failure. Reported CI baseline is **11.8 minutes**, not a same-host comparison.
- First implementation gate: eight non-browser steps passed; browser **67 passed,
  1 failed**, **168.0s**. Forced SRGB8 produced code **138** versus ideal **137**;
  reduced-precision UI was correctly displayed. Fixed the test to allow one code
  only on SRGB8, retaining exact float-path pixels and all restoration/warning
  assertions. The failure also exposed that `testInfo.status` is not yet failed
  inside a test-body `finally`; an explicit catch flag now ensures diagnostic
  JSON is printed on failure as well as attached.
- Final `pnpm gate`: **9/9 PASS**, core161 + web725 + desktop72 + scripts11
  = **969** unit tests, lint/typecheck/build PASS, OSV167 with zero known
  vulnerabilities. Full E2E run 1: **68/68 PASS**, browser step **160.6s**;
  restoration available-precision **1.4s**, forced SRGB8 **1.3s**.
- Full E2E run 2: **68/68 PASS**, browser step **162.3s**.
- Full E2E run 3: **68/68 PASS**, browser step **161.3s**.
- Three consecutive full runs: **204/204**, retries **0**. Mean browser step
  **161.4s**, versus baseline **235.6s** (74.2s / 31.5% shorter). Restoration
  cases took 1.4+1.3s, 1.5+1.3s, and 1.4+1.3s respectively.
- [Gate summary](2026-09-07-ci-color-verify-gate.md) and
  [baseline, first-failure, and three final E2E logs](2026-09-07-ci-color-verify-e2e.txt).
  Claude review and a subsequent Linux CI run remain with the coordinator.

Timing is local macOS Chromium, same worktree/port/configuration, no CI run or
push performed. Next dev/compiler caches and unrelated test timing differ
between runs, so the entire suite improvement cannot be attributed solely to
removing the extra browser. The restoration test itself fell from 35.1s to a
combined 2.7s while adding explicit SRGB8 coverage. Every server run was preceded
by `lsof -nP -iTCP:32119 -sTCP:LISTEN` (no listener; macOS emitted an unrelated
Time Machine mount warning). No retries were used.
