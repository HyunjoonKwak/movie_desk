import { upsertClipKeyframe, type ID, type MediaClip, type Project } from "@movie-desk/core";
import type { TrackPoint } from "./motion-track";

// Turn tracked center points into transform.x / transform.y keyframes,
// expressed relative to the first point so the clip's existing position is
// preserved (we animate the *delta*). Normalized track coords are 0..1 with
// origin top-left; transform x/y are centered (-1..1-ish), so we map the
// delta from the anchor.
export const applyMotionTrack = (
  project: Project,
  clip: MediaClip,
  points: readonly TrackPoint[],
): Project => {
  if (points.length < 2) return project;
  const anchor = points[0]!;
  let next = project;
  for (const pt of points) {
    const relMs = pt.atMs - clip.start;
    // Convert normalized delta to centered transform space ([-1,1] across the
    // full frame ≈ delta * 2).
    const dx = (pt.x - anchor.x) * 2;
    const dy = (pt.y - anchor.y) * 2;
    next = upsertClipKeyframe(next, clip.id as ID, "transform.x", relMs, dx, "linear");
    next = upsertClipKeyframe(next, clip.id as ID, "transform.y", relMs, dy, "linear");
  }
  return next;
};
