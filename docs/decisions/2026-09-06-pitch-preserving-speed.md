# Pitch-preserving speed — 2026-09-06

Use a self-contained WSOLA implementation with linked stereo alignment, shared by
preview and export and executed in a Web Worker. No runtime network dependency
or third-party DSP dependency is added. Windows retain original-rate samples and
advance source anchors according to the clip speed integral; bounded correlation
aligns overlapping windows. This preserves tonal pitch while changing duration.

`MediaClip.preservePitch?: boolean` is additive. Missing and false mean historical
non-preserving playback. New speed edits also remain opt-in (false/missing):
this avoids silently changing sound and avoids an unannounced fallback during a
first render. The explicit Pitch preserve toggle is a single undo transaction.
Supported forward instantaneous rates are 0.25–4 inclusive. Reverse and rates
outside this interval use interpolated varispeed; UI explains this limitation.
Transport shuttle rate remains an independent playbackRate multiplier.

Preview starts historical playback while rendering; completed renders are reused
at the next scheduling opportunity. Cache identity includes asset, sample rate,
trim, duration, speed curve and preserve flag. PCM cache is bounded by bytes.
No DSP runs inline as a worker-error fallback: export reports an error, preview
continues the immediate historical path. Linear interpolation improves the old
nearest-neighbour path but does not claim band-limited resampling.
