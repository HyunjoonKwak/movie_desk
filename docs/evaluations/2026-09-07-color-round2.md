# B’4a review round 2

Review base: `32ed73e`. Same branch/worktree; no dependency, audio, exporter or rendering-math edits, push, or main merge.

| Review item | Result | Evidence |
| --- | --- | --- |
| NEAREST code preservation | Fixed | Real 1920×1080 GPU fixture: 576 isolated white source texels; 576/36,864 sampled near-white values (1.5625%), only codes 0/255; script throws on regression |
| Portrait waveform | Fixed | Default and painter column counts bounded by source width; unit fixture fills every one of 81 columns |
| Context loss and retry | Fixed | Loss/restore clears reader/canvas cache, restores redraw, removes listeners on unsubscribe; generation checks reject old GPU/worker results; unit context lifecycle test and product E2E transient-error retry |
| Feature matrix | Fixed | Combined color row marked partial; scope-only verification note; header names combined color row |
| Mode lifecycle | Fixed | Kind ref and redraw preserve worker/resources/statistics across mode changes |
| Per-frame allocation | Improved | Worker transfers pixel array back; reader reuses it; real-GPU harness verifies array identity; scratch OffscreenCanvas reused per worker |
| Vector scale | Fixed | Full-range Cb/Cr mapping and graticule; boundary coordinates clamped; red (99,0), neutral (128,128); boundary-primary regression |
| Low-priority cleanup | Fixed | Single error handler, fail declared before use, capture reentry guard/test, frozen arithmetic fixture instead of git-show dependency, sample percentages |

Validation: `COLOR_AUDIT=1 pnpm gate --report docs/evaluations/2026-09-07-color-gate.md`; scope unit tests; `node scripts/color/frame-sync.mjs`; `node scripts/color/scopes-baseline.mjs`; `git diff --check`.

See [color audit](2026-09-07-color-audit.md) for final gate totals and measured NEAREST performance, [gate table](2026-09-07-color-gate.md), [GPU sparse/frame evidence](2026-09-07-color-scopes-frame-sync.json), and [performance JSON](2026-09-07-color-scopes-performance.json).

Limits: point samples can miss off-grid clipped texels; sample percentages are not full-frame area estimates. Context regression validates scope-reader lifecycle and stale-result rejection, not restoration of all compositor resources. Linear color processing and LUT space contracts remain B’4b.
