# Reload path / preview backlog — 2026-09-06

Branch `codex/a5-reload-path`, base `71fabdb`. Isolated worktree; Chrome ephemeral profile,
1,000 assets (200 AAC videos + 800 PNG), viewport 1440×900, 16 mounted cards in dev (24 in the production build).

## Measurement method

`node apps/web/scripts/bench-library.mjs --url http://127.0.0.1:3105 --out <result.json>`.
Opt-in `sessionStorage["bench.reload"]` enables `performance.measure("reload:…")` spans.
The existing reload metric is retained unchanged: Playwright reload followed by count polling
at 250 ms intervals. This includes navigation, module loading/hydration and polling latency;
it is not just persistence CPU time. Async spans overlap and must not be summed.
`zod` includes the nested JSON parse; subtract the `json` span for validation alone.

## Decisions

Baseline: 675.2 ms reload-to-ready, first library read starts 399.0 ms after navigation.
Library JSON is 244,659 bytes on this base (the previous waveform separation is already present).
Search/geocoding, sorting and grouping are sub-2 ms per call; no lazy search or schema weakening.

1. Yjs startup measured 152.1 ms and applied the document four times. Restore once after
   `whenSynced`; ignore empty transactions and reentrant/local transactions. Keep full schema
   validation, migration and subsequent remote updates. A real Y.Doc regression test covers
   multi-update startup, empty transactions and later remote edits.
2. The first source-health pass started at 449.0 ms and ran 1,068.8 ms, overlapping restore.
   Delay library-wide checks by one second, cancelling obsolete scheduled passes as the library
   changes. Focus/visibility rechecks and preview/export preflight remain immediate.

An intermediate run was 608.8 ms before empty-transaction suppression. A run concurrent with
production build was 1,139.9 ms (first library read 659.6 ms); retain this as a contention warning,
not an isolated performance comparison. Final isolated runs follow below.

## Preview and snapshots

The card hover action regenerates thumbnail, filmstrip and waveform using the existing import
preview generators and the current original source adapter, then writes `putAssetPreviews` with
its default missing-field replacement. Store listeners refresh visible cards; successful writes
clear legacy inline previews outside undo history. Missing originals hide the action; progress,
success and failure toasts are translated. Leases are released on success and failure.
The operation materializes the original as a File because the existing generators accept File;
very large originals therefore have a temporary memory cost.

Snapshot policy proposes the oldest overflow beyond the latest 20 per project. Saving never
automatically deletes. The UI shows the proposed count and requires confirmation; cleanup deletes
only the reviewed ids in the reviewed project in one transaction. GC already enumerates the
snapshot table on each scan, so removed rows naturally leave the keep set; a regression verifies
that enumeration includes only remaining rows. No GC implementation change is needed.

E2E deletes stored preview rows, reloads to an empty card, regenerates, and reloads again to prove
persistence. Unit tests cover source/rotation use, missing derived-field replacement, storage
failure lease release, retention boundaries, project isolation, and remaining-row enumeration.

## Final measurements

| Metric | Baseline dev | Final dev | Production |
| --- | ---: | ---: | ---: |
| Reload → library ready (ms) | 675.2 | 616.4 | 528.1 |
| Import (ms) | 11554.2 | 10682.2 | 16308.6 |
| Search (ms) | 52.7 | 53.6 | 67.6 |
| DOM cards after reload | 16.0 | 16.0 | 24.0 |

Startup spans below show individual durations in ms (first startup only; later GC library reads excluded).

| Span | Baseline dev | Final dev |
| --- | ---: | ---: |
| library-read | 0.48, 4.12 | 0.29, 9.18 |
| json | 0.20, 0.22 | 0.22, 0.20 |
| zod | 3.45, 1.97 | 3.52, 1.97 |
| yjs-load | 152.12 | 91.64 |
| yjs-read-validate | not instrumented | 1.74 |
| applyFromDoc | 2.57, 1.41, 1.08, 1.22 | 7.28 |
| loadProject | 2.68, 0.34, 0.25, 0.22, 0.21 | 2.66, 0.24 |
| search-index | 1.58, 0.31, 1.58, 0.09, 1.01, 0.04 | 1.44, 0.17, 1.26, 0.09 |
| sort | 0.13, 0.08, 0.10, 0.06, 0.08, 0.06 | 0.09, 0.06, 0.09, 0.06 |
| group | 0.25, 0.16, 0.20, 0.18, 0.12, 0.10 | 0.21, 0.16, 0.16, 0.13 |
| preview-request | 8.19 | 1.88 |
| source-health | 1068.75 | 1119.59 |

Final dev navigation response end 146.5 ms, DOMContentLoaded 159.4 ms, load event 235.7 ms,
first library read 382.2 ms. Yjs settles at 487.9 ms; visible preview query starts 586.8 ms.
The source-health pass now starts at 1,519.9 ms, after the measured ready boundary, rather than
449.0 ms before it. Yjs load decreases 152.1 → 91.6 ms; application count decreases 4 → 1.
The dev 400 ms target remains **unmet** (616.4 ms final); these single-run measurements are not
statistical proof. Startup module/hydration cost alone nearly exhausts the budget. Further work
should profile that navigation/hydration interval separately before changing loading boundaries;
no speculative schema/cache/search changes were included.

Production (`NEXT_DIST_DIR=.next-gate next start -p 3106`): response end 14.3 ms,
DOMContentLoaded 71.5 ms, load event 90.5 ms; first library read 311.8 ms, Yjs sync 400.9 ms,
preview query 454.0–474.7 ms, ready 528.1 ms. Production also misses 400 ms under the unchanged
benchmark definition. Production mounted 24 cards, so do not attribute the whole dev/prod delta
to bundling alone. Both builds were measured sequentially with no gate/build running.

| Production startup span | Durations (ms) |
| --- | ---: |
| library-read | 0.47 |
| json | 0.28 |
| zod | 6.41 |
| yjs-load | 77.46 |
| yjs-read-validate | 6.44 |
| applyFromDoc | 11.16 |
| loadProject | 4.58, 0.41 |
| search-index | 4.02, 3.00 |
| sort | 0.16, 0.32 |
| group | 0.42, 0.23 |
| preview-request | 20.65 |
| source-health | 632.46 |

## Validation and handoff

Final `pnpm gate` **PASS**: frozen install, version policy, lint, typecheck, unit tests
(core 107, web 471, desktop 56, scripts 11), OSV audit (167 production packages, no known
vulnerabilities), production build, Playwright install, and Chromium E2E **45/45**.
The added preview/snapshot browser tests also passed 4/4 in an isolated focused run.
One earlier full run lost the test server connection; the final passing gate ran after shutting
down both measurement servers. An earlier new test used a thumbnail-dependent accessible name;
it now identifies the card by its stable container and visible filename even when the image is absent.

Decision: deliver the measured two-path change and both backlog features for review, but do not
claim the requested sub-400 ms performance outcome. Next investigation is navigation/module
hydration before the first library read. No push, main merge, other worktree edits, schema
weakening, i18n formatting, or unrelated formatting was performed.

Raw results: [baseline and final JSON](2026-09-06-reload-path-results.json).
