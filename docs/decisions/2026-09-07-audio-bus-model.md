# B′3 audio routing model — 2026-09-07

## Compatibility and pan

Optional `Track.audio = { gainDb?, pan?, busId? }` and `Project.audio = { buses, master }`. Absent values mean 0 dB, center, direct master. Gain is stored/displayed in dB, constrained to −60…+12; pan −1…+1. −60 is attenuation, not mute. Bus mute is additive and explicit. No automatic limiter/normalization preference changes.

Use Web Audio's stereo equal-power panner: center preserves L/R unity; moving left crossfeeds R with sine/cosine weights, moving right crossfeeds L. Mono is explicitly upmixed to stereo before panning to retain the old preview/export center level. This deliberately differs from the recommended mono −3 dB center law, which would attenuate existing mono projects. For correlated duplicated mono, summed stereo power (a loudness-related quantity) rises by at most +3.01 dB. Individual channel peaks rise to 2.0× (+6.02 dB) at hard pan and 1.7071× (+4.65 dB) at ±0.5; these peaks drive the limiter, so meters and overload warnings expose both the gain and its consequences. The coordinator approved this compatibility-first law on 2026-09-07: the old export duplicated mono into L/R, so explicit preview stereo upmix and identical export crossfeed preserve existing center gain without migrating saved projects.

## Routing and scope

Clip source/pitch/effects → volume automation → track gain/pan/mute/solo → one optional bus gain/mute → master gain → existing export ducking/linked limiter → existing export LUFS normalization → encoder. Volume keyframes REPLACE base clip volume, then multiply track, bus, master gains; they do not multiply the base volume again. In the linear routing stage gain multiplication commutes with pan and summation. Existing ducking groups remain voice/video and music/audio, not editable buses. The legacy limiter follows the complete user mix before normalization so overloads remain bounded as before. Pre-limiter overload counts and normalized pre-clamp clipped sample counts are reported separately from approximate true peak measured on the post-clamp Float32 PCM actually passed to AudioEncoder.

One-level buses only: no sends, feedback, nested buses, bus pan or effects. Missing/deleted bus IDs fall back to master. The mixer edit API uses `busId: ""` only as a transient clear-assignment command; it removes the stored busId and is never persisted. Deleting a bus clears track references in the same undo command. Bus IDs are unique, names are 1…100 characters. CRDT stores track routing in existing per-track entities, and project audio as one last-writer-wins settings value; simultaneous edits to different project buses can conflict, as documented rather than implying per-field collaboration.

## Meters

Local AudioWorklets pass stereo PCM unchanged and measure every sample; results cross to main every 2,048 frames and publish at most once per animation frame. Track, bus and master meters show peak/RMS in dBFS with a 1.5 second peak/clip hold. Master short-term LUFS uses a contiguous 3-second K-weighted stereo window (no integrated gating), with a warm-up placeholder. Stopped/scrub meters remain explicitly labelled waveform estimates. AudioWorklet failure preserves audio and falls back to waveform estimates with an explicit estimated label, including during playback.

Export true peak is an explicitly approximate 4× 16-tap windowed-sinc interpolator, preserving history across chunks and flushing latency at the end. It is not a certified BS.1770 measurement. True/sample peaks measure the final normalized, clamped Float32 PCM before encoding, not decoded lossy AAC. Clipped-sample counts still represent normalized channel samples exceeding full scale before that clamp; limiter overload is a separate count. No external dependencies or network service.

## Round 2 implementation details

Initial graph parameters are initialized at their target before playback to preserve legacy PCM; subsequent gain/pan edits use a 10 ms exponential time constant. Unchanged targets do not add automation and unchanged output destinations do not reconnect. Late inputs connect directly to master and are removed by the next project update if still absent.

When worklets are unavailable, playing/stopped/scrub views use explicitly labelled waveform estimates. Asset lookup maps are memoized by immutable mediaLibrary identity, and all track/header/bus/master estimates share one calculation per playhead/routing/waveform snapshot. This remains a maximum-envelope estimate, not phase-aware PCM summation.

## Round 3 recovery and buffer ownership

Recovery when loading JSON, library snapshots or CRDT data operates at two different block boundaries: an invalid `track.audio` discards that track’s entire audio block while preserving other valid tracks, but an invalid `project.audio` discards the entire bus list and master settings together—even one invalid gain among ten buses removes all ten buses and the master gain. When `project.audio` is discarded, surviving tracks retain their `busId` values as dangling references; `resolveTrackRoute` falls back to unity bus/master gain while retaining each valid track’s own gain and pan. Timeline clips and assets remain intact, and load-bearing project corruption still fails validation.

Recovery is persisted, not just displayed: `live-doc.ts` calls `projectCrdt.write` immediately after `loadProject` in the same load tick, and `project-crdt.ts` deletes the missing `audio` metadata key; the repaired CRDT state propagates to IndexedDB and the next JSON save also omits the discarded settings. Recovery metadata alone stays in a WeakSet outside persistence, is consumed on actual load, and uses a stable toast ID to coalesce duplicate library/CRDT hydration notices. The one-time localized warning addresses the notification part of the product rule against silently overwriting user edits, but does not provide confirmation or undo for this permanent replacement of unreadable settings.

Backup guidance is needed: preserve stored project data before opening/recovery, or retain the original imported JSON file unchanged; waiting until a manual save is too late because recovery auto-persists, and the current warning does not offer a backup flow.

Known limitation: explicit `audio: null` also triggers the recovery warning because detection distinguishes only `undefined`, so an intentionally empty null block can produce a misleading recovery notice; this documentation-only round leaves that behavior unchanged.

Export routing borrows scratch owned by each ProjectAudioMixer instance, grows it only when capacity is insufficient and releases it on disposal. Each clip's routed PCM is accumulated synchronously before reuse. The core helper rejects input/output buffer aliasing and undersized scratch; callers omitting scratch retain independently owned output arrays.
