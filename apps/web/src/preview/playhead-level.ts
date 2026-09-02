import {
  type ID,
  type MediaAsset,
  type Project,
  isMediaClip,
  sourceOffsetForRamp,
} from "@movie-desk/core";

// Estimates the instantaneous audio level (0..1) at the current playhead by
// sampling each audio-bearing clip's precomputed peak envelope. There is no
// live audio graph during preview, so this drives the level meter instead.
export const playheadLevel = (
  project: Project,
  getAsset: (id: ID) => MediaAsset | undefined,
): number => {
  const at = project.timeline.playhead;
  let level = 0;
  for (const track of project.timeline.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!isMediaClip(clip)) continue;
      if (at < clip.start || at >= clip.start + clip.duration) continue;
      const asset = getAsset(clip.assetId);
      const peaks = asset?.waveformPeaks;
      if (!asset || !peaks || peaks.length === 0) continue;
      const dur = asset.durationMs || 1;
      const srcMs = clip.trimIn + sourceOffsetForRamp(clip, at - clip.start);
      const bin = Math.max(0, Math.min(peaks.length - 1, Math.floor((srcMs / dur) * peaks.length)));
      const v = (peaks[bin] ?? 0) * (clip.volume ?? 1);
      // Combine tracks by taking the loudest contributor.
      if (v > level) level = v;
    }
  }
  return Math.min(1, level);
};
