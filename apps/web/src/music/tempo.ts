import type { Track } from "@movie-desk/core";

// Median cut interval of the VIDEO tracks, expressed as a musical tempo so
// it can be compared against track BPM. Text/subtitle and audio clips are
// deliberately excluded — auto-subtitles would otherwise drown the actual
// cut rhythm in caption cue boundaries. Halved/doubled into the 60–180
// range (a 2s cut cadence pairs naturally with 120 BPM — cuts land every
// 4 beats; bpmFit treats half/double time as equivalent anyway).
export const projectCutBpm = (tracks: readonly Track[]): number | null => {
  const boundaries = new Set<number>([0]);
  for (const track of tracks) {
    if (track.kind !== "video") continue;
    for (const clip of track.clips) {
      boundaries.add(clip.start);
      boundaries.add(clip.start + clip.duration);
    }
  }
  const points = [...boundaries].toSorted((a, b) => a - b);
  if (points.length < 5) return null; // too few cuts to call it a rhythm
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i]! - points[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  const sorted = gaps.toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  let bpm = 60000 / median;
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  while (bpm < 60) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
};
