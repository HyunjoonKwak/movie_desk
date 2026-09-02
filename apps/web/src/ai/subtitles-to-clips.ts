import {
  addClip,
  addTrackAt,
  newId,
  type Project,
  type Track,
  type MediaClip,
} from "@movie-desk/core";
import type { Subtitle } from "./types";

// Convert a list of subtitles (source-relative ms) into text clips placed
// on a dedicated "Subtitles" text track, anchored to the visible portion
// of the source clip in project time.
export const subtitlesToClips = (
  project: Project,
  sourceClip: MediaClip,
  subtitles: readonly Subtitle[],
): Project => {
  if (subtitles.length === 0) return project;

  // Ensure a dedicated subtitle track exists at the top — index 0
  // composites above everything, so captions are never hidden.
  let next = project;
  let track: Track | undefined = next.timeline.tracks.find((t) => t.name === "Subtitles");
  if (!track) {
    next = addTrackAt(
      next,
      {
        kind: "text",
        name: "Subtitles",
        height: 36,
        muted: false,
        solo: false,
        locked: false,
      },
      0,
    );
    track = next.timeline.tracks[0]!;
  }

  const srcStart = sourceClip.trimIn;
  const srcEnd = sourceClip.trimIn + sourceClip.duration / sourceClip.speed;

  for (const sub of subtitles) {
    const start = Math.max(sub.start, srcStart);
    const end = Math.min(sub.end, srcEnd);
    if (end <= start) continue;
    const timelineStart = sourceClip.start + (start - srcStart) * sourceClip.speed;
    const timelineDuration = (end - start) * sourceClip.speed;
    next = addClip(next, track.id, {
      kind: "text",
      id: newId(),
      start: timelineStart,
      duration: Math.max(200, timelineDuration),
      speed: 1,
      effects: [],
      keyframes: [],
      text: sub.text,
      font: "Inter, system-ui, sans-serif",
      size: 56,
      color: "#ffffff",
    });
  }
  return next;
};
