import { sampleKeyframeTrack, type KeyframeTrack } from "@movie-desk/core";

// Sample a clip's volume keyframe track into a WebAudio gain curve over a
// clip-relative timeline window. Mirrors the export mixer's semantics
// (audio-mixer.ts): a keyframed value REPLACES the static clip volume;
// where the track has no answer the base volume applies. Negative values
// clamp to silence.
export const sampleVolumeCurve = (
  track: KeyframeTrack,
  baseVolume: number,
  relativeStartMs: number,
  relativeEndMs: number,
  samples: number,
): Float32Array => {
  const n = Math.max(2, samples);
  const curve = new Float32Array(n);
  const span = relativeEndMs - relativeStartMs;
  for (let i = 0; i < n; i++) {
    const relativeMs = relativeStartMs + (i / (n - 1)) * span;
    curve[i] = Math.max(0, sampleKeyframeTrack(track, relativeMs) ?? baseVolume);
  }
  return curve;
};
