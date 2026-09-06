import type { Clip } from "../model/clip";
import type { Ms } from "../utils/time";
import { sampleKeyframeTrack } from "./keyframes";

// Speed ramps. A clip may carry a "speed" keyframe track whose values are
// playback-rate multipliers over clip-relative time. To find which source
// frame to show at a given clip-relative time we integrate the rate.
//
// When no speed track exists we fall back to the constant `clip.speed`.

const SPEED_TARGET = "speed";

export const hasSpeedRamp = (clip: Clip): boolean =>
  clip.keyframes.some((k) => k.target === SPEED_TARGET && k.keyframes.length >= 2);

// Map a clip-relative timeline time to a source-relative offset (ms) by
// integrating the rate curve in small steps. `stepMs` trades accuracy for
// speed; 10ms is plenty for editing/preview.
export const sourceOffsetForRamp = (clip: Clip, clipRelMs: Ms, stepMs = 10): Ms => {
  const track = clip.keyframes.find((k) => k.target === SPEED_TARGET);
  if (!track || track.keyframes.length < 2) {
    return clipRelMs * clip.speed;
  }
  let acc = 0;
  for (let t = 0; t < clipRelMs; t += stepMs) {
    const rate = Math.max(0.05, sampleKeyframeTrack(track, t) ?? clip.speed);
    acc += rate * Math.min(stepMs, clipRelMs - t);
  }
  return acc;
};

// Average rate across the clip, used to estimate the source span the clip
// consumes (so trims and previews stay consistent).
export const averageRate = (clip: Clip): number => {
  const track = clip.keyframes.find((k) => k.target === SPEED_TARGET);
  if (!track || track.keyframes.length < 2) return clip.speed;
  const samples = 16;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * clip.duration;
    sum += Math.max(0.05, sampleKeyframeTrack(track, t) ?? clip.speed);
  }
  return sum / samples;
};

// Inverse of sourceOffsetForRamp using the same 10ms integration grid.
// After the final keyframe the rate is constant, so long tails are O(1).
export const durationForSourceSpan = (clip: Clip, sourceMs: Ms): Ms => {
  const track = clip.keyframes.find((k) => k.target === SPEED_TARGET);
  if (!track || track.keyframes.length < 2) return sourceMs / Math.max(0.05, clip.speed);
  let remaining = Math.max(0, sourceMs);
  let at = 0;
  const last = track.keyframes[track.keyframes.length - 1]!.at;
  while (at < last) {
    const rate = Math.max(0.05, sampleKeyframeTrack(track, at) ?? clip.speed);
    if (remaining <= rate * 10) return at + remaining / rate;
    remaining -= rate * 10;
    at += 10;
  }
  return at + remaining / Math.max(0.05, sampleKeyframeTrack(track, at) ?? clip.speed);
};
