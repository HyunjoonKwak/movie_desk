# Reload path and preview recovery — 2026-09-06 review revision

Branch `codex/a5-reload-path`, review base `e451255` (ancestor `main 71fabdb`).

## Current performance contract

The coordinator **retired the reload-to-ready 400 ms target**. The old Playwright DOM polling
metric is no longer an acceptance metric. Three separately reported values replace it:

1. **First usable grid:** `reload:grid-ready`, emitted by the media panel in a layout effect after
   media and a measured grid width have committed. Its timestamp is relative to navigationStart.
   This means the library row is usable; it does not pretend that all Yjs/background work is done.
2. **Restoration cost, target <150 ms:** sum of `library-read`, `json`, `zod`, `yjs-load`,
   `yjs-read-validate`, and `applyFromDoc`, through the first completed document application.
   JSON and zod are now separate, non-nested spans. `loadProject` is already inside application,
   so it is not added again. Later GC row reads are excluded. Dev StrictMode duplicate startup
   reads remain included. This is the requested elapsed-span sum, not pure CPU time: Yjs load
   includes async waiting and can overlap the grid's rendering.
3. **Background settle:** the later completion of the first source-health pass and first preview
   batch (including its store application). Both must start **after** the grid mark, avoiding
   contention with that first usable commit. Their elapsed duration is not charged to restoration.

`bench-library.mjs` imports 1,000 assets (200 AAC video, 800 PNG) once into an ephemeral Chrome
profile, then reloads five times. It reads User Timing entries instead of polling DOM readiness.
p50/p95 use nearest-rank over the five samples (p95 is the maximum); no warm-up sample is discarded.
Both environments use 1440×900. Dev mounted 16 cards; production mounted 24 cards. Runs were
sequential after the gate, with no concurrent build or test browser workload.

Commands:

```sh
NEXT_DIST_DIR=.next-bench pnpm --filter @movie-desk/web exec next dev --turbopack -p 3105
node apps/web/scripts/bench-library.mjs --url http://127.0.0.1:3105 --out /tmp/a5-r2-dev.json
NEXT_DIST_DIR=.next-gate pnpm --filter @movie-desk/web exec next start -p 3106
node apps/web/scripts/bench-library.mjs --url http://127.0.0.1:3106 --out /tmp/a5-r2-prod.json
```

## Five-run results

| Metric (ms from navigationStart except restoration sum) | Dev p50 | Dev p95 | Production p50 | Production p95 |
| --- | ---: | ---: | ---: | ---: |
| First usable grid | 386.32 | 578.65 | 336.76 | 341.47 |
| Restoration cost | 144.23 | 166.86 | 71.84 | 78.40 |
| Background settle | 2208.89 | 2427.85 | 1868.51 | 1982.34 |

**Budget decision:** production p50/p95 both satisfy <150 ms. Dev p50 satisfies it; dev p95
**does not** (166.86 ms). The slowest dev sample has a 145.84 ms Yjs-load span; keep this tail
visible rather than claiming an across-environment pass from the median. No additional speculative
loading/schema changes were made as part of this review correction.

Both background starts follow the grid mark in **5/5 dev and 5/5 production samples**.

| Environment / run | Grid | Restoration | Background settle | Both background starts after grid |
| --- | ---: | ---: | ---: | --- |
| dev / 1 | 516.87 | 166.86 | 2294.75 | True |
| dev / 2 | 365.47 | 97.24 | 2136.79 | True |
| dev / 3 | 578.65 | 144.31 | 2427.85 | True |
| dev / 4 | 386.32 | 144.23 | 2208.89 | True |
| dev / 5 | 365.39 | 141.16 | 2138.35 | True |
| prod / 1 | 339.91 | 78.40 | 1772.53 | True |
| prod / 2 | 341.47 | 61.42 | 1982.34 | True |
| prod / 3 | 334.98 | 66.41 | 1907.31 | True |
| prod / 4 | 336.76 | 71.84 | 1868.51 | True |
| prod / 5 | 335.28 | 72.43 | 1810.44 | True |

| Restore stage, per-run sum (ms) | Dev p50 | Dev p95 | Production p50 | Production p95 |
| --- | ---: | ---: | ---: | ---: |
| library-read | 4.31 | 7.12 | 0.49 | 0.74 |
| json | 0.43 | 0.59 | 0.29 | 0.53 |
| zod | 4.38 | 5.79 | 3.74 | 5.25 |
| yjs-load | 127.94 | 145.78 | 61.58 | 64.78 |
| yjs-read-validate | 2.43 | 3.68 | 2.59 | 3.22 |
| applyFromDoc | 2.04 | 8.94 | 1.91 | 6.95 |

## Review corrections

- OPFS reconstruction references `readMediaFile`'s Blob through a File without materializing
  bytes. Desktop video is passed to the shared ranged frame sampler directly; image decoding
  uses a leased playback URL. There is no whole-original `source.read(0, sizeBytes)`.
- Waveforms use `ensureAudioVariant` and decode only the audio variant. An unavailable variant
  is a failed waveform kind, with no whole-video fallback. Unsupported/silent video may therefore
  report a waveform warning while retaining its existing preview.
- Full replacement is allowed only for all expected kinds: image thumb; audio waveform; video
  thumb, filmstrip and waveform. Partial output uses `replaceMissing: false`, preserves stored
  previews, and reports the failed translated kind names in a warning, never a success toast.
  Total decode failure and storage failure remain errors. Source errors suggest relinking.
- Module-owned jobs deduplicate by asset id and cap active regeneration at two. A subscribed
  pending set keeps remounted cards disabled. A release stack covers later lease acquisition
  failure as well as decode/storage failure.
- Metrics read sessionStorage once inside try/catch and share a no-op when storage is denied.
- The first source-health timer is armed once and reads the latest asset ref when it fires;
  later changes check immediately. It uses `FIRST_PASS_DELAY_MS` beside `FORCE_THROTTLE_MS`.
  Immediate preview/export checks and focus/visibility behavior remain intact.
- Snapshot candidates are memoized. The app confirmation dialog lists the frozen proposal's
  labels/dates and explicitly warns that originals referenced only by those snapshots may be
  removed in the next GC. Cleanup uses one bulkGet, project filtering, and one bulkDelete inside
  a transaction; its error handler reports a toast. Saving never automatically removes snapshots.
- E2E locates the imported project among library rows instead of assuming one row. Type-only
  Yjs import and requested import/line-width cleanup are included. Translation changes append
  keys with the existing four-space indentation.

## Validation

`pnpm gate` **PASS**, including install, version policy, lint, typecheck, unit tests,
OSV audit, production build, Playwright install, and **45/45 Chromium E2E**.
Unit counts: core 107, web 477, desktop 56, scripts 11 (**651 total**).
New/updated regression coverage includes throwing storage access, zero eager disk reads,
OPFS Blob handling, audio-variant decoding, partial filmstrip preservation, no video fallback,
lease acquisition failure, storage errors, shared deduplication/concurrency, snapshot bulk cleanup,
and app-dialog cancel/confirm flows with preview regeneration surviving reload.

The earlier `e451255` single-run values (dev 675→616 ms, production 528 ms) measured a different,
now-retired DOM polling boundary. They are historical evidence, not comparable budget results.
The previous Yjs 4→1 application reduction and source-health overlap finding remain the reason
for the original two-path change; full stored schema validation remains enabled.

Raw current samples: [five-run review results](2026-09-06-reload-path-review-results.json).
Historical raw samples: [initial reload investigation](2026-09-06-reload-path-results.json).
