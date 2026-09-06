# B′3 audio routing model — 2026-09-07

## Compatibility and pan

Optional `Track.audio = { gainDb?, pan?, busId? }` and `Project.audio = { buses, master }`. Absent values mean 0 dB, center, direct master. Gain is stored/displayed in dB, constrained to −60…+12; pan −1…+1. −60 is attenuation, not mute. Bus mute is additive and explicit. No automatic limiter/normalization preference changes.

Use Web Audio's stereo equal-power panner: center preserves L/R unity; moving left crossfeeds R with sine/cosine weights, moving right crossfeeds L. Mono is explicitly upmixed to stereo before panning to retain the old preview/export center level. This deliberately differs from the recommended mono −3 dB center law, which would attenuate existing mono projects. A correlated mono signal can gain up to +3 dB while moving off-center; measured meters and overload warnings expose this. The coordinator approved this compatibility-first law on 2026-09-07: the old export duplicated mono into L/R, so explicit preview stereo upmix and identical export crossfeed preserve existing center gain without migrating saved projects.

## Routing and scope

Clip source/pitch/effects → volume automation → track gain/pan/mute/solo → one optional bus gain/mute → master gain → existing export ducking/linked limiter → existing export LUFS normalization → encoder. Volume keyframes REPLACE base clip volume, then multiply track, bus, master gains; they do not multiply the base volume again. In the linear routing stage gain multiplication commutes with pan and summation. Existing ducking groups remain voice/video and music/audio, not editable buses. The legacy limiter follows the complete user mix before normalization so overloads remain bounded as before. Pre-limiter overload counts are reported separately from normalized pre-clamp clipped samples and approximate true peak.

One-level buses only: no sends, feedback, nested buses, bus pan or effects. Missing/deleted bus IDs fall back to master. Deleting a bus clears track references in the same undo command. Bus IDs are unique, names are 1…100 characters. CRDT stores track routing in existing per-track entities, and project audio as one last-writer-wins settings value; simultaneous edits to different project buses can conflict, as documented rather than implying per-field collaboration.

## Meters

Local AudioWorklets pass stereo PCM unchanged and measure every sample; results cross to main every 2,048 frames and publish at most once per animation frame. Track, bus and master meters show peak/RMS in dBFS with a 1.5 second peak/clip hold. Master short-term LUFS uses a contiguous 3-second K-weighted stereo window (no integrated gating), with a warm-up placeholder. Stopped/scrub meters remain explicitly labelled waveform estimates. AudioWorklet failure preserves audio with an explicit unavailable meter label.

Export true peak is an explicitly approximate 4× 16-tap windowed-sinc interpolator, preserving history across chunks and flushing latency at the end. It is not a certified BS.1770 measurement. Counts represent channel samples exceeding full scale, before final normalized clamping; limiter overload is a separate count. No external dependencies or network service.
