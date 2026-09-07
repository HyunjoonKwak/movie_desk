# Audio cleanup round 2 — 2026-09-07

Base: `51226ef`; branch: `codex/audio-cleanup`.

1. Worker peak diagnostics now consistently contain cumulative values. Pre-clamp
   overload counts travel in the detached checkpoint, and the exporter takes the
   latest count exactly as it does the peaks. Gain 1/0.3/4 tests check every chunk
   against cumulative overloads; the real-combine exporter regression still fixes
   the completion result at 4100 clipped and 6 limited samples.
2. `applyEncoderGainAndMeter` explicitly mutates the locally allocated mix before
   constructing the response. Tests preserve caller-owned voice buffers and prior
   checkpoints while comparing every returned PCM sample to the reference.
3. `docs/07-work-order.md` now tracks crop-dependent reference-channel selection:
   preview/export can select different channels and therefore splice positions.
   DSP selection policy remains a separate follow-up.
4. Exported `TruePeakCheckpoint` replaces inferred worker state types. Restore
   rejects mismatched channel counts or ring lengths before any mutation; mono
   and three-channel checkpoint tests prove stereo state remains unchanged.
   The benchmark documents repository-root cwd and rejects worker errors or a
   30-second timeout. Injected throwing and silent worker fixtures both exited
   with the expected errors (timeout shortened to one second for this check).

Normal offline Chromium benchmark: all six trials (60/600 seconds, three each)
completed with exact baseline/worker peak equality. This run verifies correctness,
not a new performance claim; it ran concurrently with gate.

Validation: [full gate](2026-09-07-audio-cleanup-round2-gate.md).
Unit total: **885** (core155/web647/desktop72/scripts11).
Port 32119 had no listener in `lsof` before gate; no other server was stopped.

Final full gate: **9/9 PASS**, Chromium E2E **61/61 PASS** (129.7s gate step).
Port 32119 was also free after gate. No renderer/effects/scopes or DSP changes.
