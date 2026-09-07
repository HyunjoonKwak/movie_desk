# B’4b round 5 — integration follow-up

## Requested corrections

1. `scripts/color/cache-memory.mjs` now defaults to main-reachable `0e6804a`
   and records its full resolved hash. Default execution passed and regenerated
   the checked-in round 4 JSON; the accompanying review table now matches it.
   Compatibility with the older RGBA8 renderer is explicit: missing managed
   caches are null, after still requires half-float, and both dispose checks
   remain mandatory. The comparison now includes the linear color pipeline,
   so it is not an isolated cache-repair speed comparison.
2. The round 4 review now states the engineering hardware floor (2 GiB dedicated
   VRAM + 8 GiB RAM, or 8 GiB unified memory with about 2 GiB graphics headroom),
   its unvalidated minimum-spec status, the 768 MiB simultaneous cache ceiling,
   the historical two-instance tracked estimate of 431.3 → 564.0 MB, excluded
   allocations, and expected degradation on smaller/memory-pressured devices.
3. Benchmark guards derive their three budget limits from Compositor constants.
   Shared constants retain exactly the same runtime values, with two pure
   arithmetic tests for largest source + 4K target and three 4K stills.
4. A visible oversize-scaling quality notice is judged warranted because it
   affects exported detail; implementation is deferred. Sampler and audio-meter
   open issues remain open, with no audio/sampler implementation or E2E edits.

## Baseline recurrence check

**Bench default baselines must be reachable from main.** This rule is also
in the benchmark script and round 4 review. All remaining hardcoded benchmark
defaults were audited with `git merge-base --is-ancestor <ref> main`: color
managed/export `0e6804a`, pitch `27128d1`, and pitch DSP `1c3c0e4` all passed.
No other branch-only default was found. The scopes baseline is a checked-in
fixture rather than a Git ref.

## Validation

The default benchmark passed all four real text/VideoFrame/still working sets,
oversize/resolution churn guards, zero steady-state managed target/FBO churn,
and texture/FBO dispose 0/0 for both revisions. The main baseline is fully
recorded as `0e6804a84fc81eb4a5aeaa9f984e37ad7bffd281` in JSON.

Before gate, `lsof -nP -iTCP:32119 -sTCP:LISTEN` returned no listener (exit 1,
with the known inaccessible Time Machine SMB mount warning); no server was
reused or stopped. Gate results are recorded in the adjacent round 5 gate report.

`pnpm gate --report docs/evaluations/2026-09-07-color-linear-round5-gate.md`:
**9/9 PASS**; core 155 + web 711 + desktop 72 + scripts 11 = **949 unit tests**;
E2E **64/64**, zero retries, gate E2E wall time **183.4 seconds** (final sampler
905 ms). Typecheck, Biome, build and OSV 167 production packages all passed.
`git diff --check` also passed. No required correction remains.
