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

## Existing AAC timing defect (separate approved export fix)

The pinned mediabunny 1.55.5 has no priming compensation option and rejects
negative packet timestamps when muxing. Its existing positive-start edit-list
writer can reserve the required metadata. The same 1.066667s issue is reported
upstream in [issue 447](https://github.com/Vanilagy/mediabunny/issues/447), with
backend-dependent delay discussed in [issue 444](https://github.com/Vanilagy/mediabunny/issues/444).

Calibrate the local AAC encoder/decoder with a deterministic probe once per
bitrate. The measured delay on this Mac is 2112 samples; do not assume 1024 or
choose a delay from a user-agent string. Add 4096 silent preroll samples before
user PCM and a silent tail after it so codec startup/end behavior cannot erase
the requested samples. Retain every encoded packet and all sample-table/data
bytes. Rewrite only the reserved audio edit-list, audio track duration and movie
duration to present `[preroll + measured delay, + requested sample count)`.
The raw media duration stays truthful. This is container timing metadata work,
not cutting compressed audio packets or modifying the dependency.

Mediabunny's own duration-from-media APIs may report the retained raw tail;
HTMLMediaElement, decodeAudioData and ffprobe are the presentation boundary
oracles. Unit tests verify every encoded packet byte survives the edit and the
first packet receives the expected negative demuxed presentation timestamp.
