import { addClip, addTrackAt, newId, type Project, type Track } from "@movie-desk/core";
import type { SubtitleCue } from "./srt";

const SUBS_TRACK_NAME = "Subtitles";

// Find the existing subtitle track or create one at the top — index 0
// composites above everything, so captions are never hidden behind video.
const ensureSubtitleTrack = (project: Project): { project: Project; track: Track } => {
  let track = project.timeline.tracks.find((t) => t.name === SUBS_TRACK_NAME);
  let next = project;
  if (!track) {
    next = addTrackAt(
      project,
      {
        kind: "text",
        name: SUBS_TRACK_NAME,
        height: 36,
        muted: false,
        solo: false,
        locked: false,
      },
      0,
    );
    track = next.timeline.tracks[0]!;
  }
  return { project: next, track };
};

// Return all text clips currently on the subtitle track, sorted by start.
export const listSubtitleClips = (project: Project) => {
  const track = project.timeline.tracks.find((t) => t.name === SUBS_TRACK_NAME);
  if (!track) return [];
  return track.clips
    .filter((c) => c.kind === "text")
    .toSorted((a, b) => a.start - b.start);
};

// Replace every subtitle clip with the supplied cues. Useful when importing
// SRT/VTT — wipes the track first to keep things predictable.
export const replaceSubtitlesFromCues = (
  project: Project,
  cues: readonly SubtitleCue[],
): Project => {
  let { project: next, track } = ensureSubtitleTrack(project);
  // Clear the existing subtitle clips by replacing the track's clip array.
  next = {
    ...next,
    timeline: {
      ...next.timeline,
      tracks: next.timeline.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: [] } : t,
      ),
    },
  };
  // Re-grab the now-empty track reference.
  track = next.timeline.tracks.find((t) => t.id === track.id)!;
  for (const cue of cues) {
    next = addClip(next, track.id, {
      kind: "text",
      id: newId(),
      start: cue.start,
      duration: Math.max(200, cue.end - cue.start),
      speed: 1,
      effects: [],
      keyframes: [],
      text: cue.text,
      font: "Inter, system-ui, sans-serif",
      size: 56,
      color: "#ffffff",
    });
  }
  return next;
};

// Serialise current subtitle clips back into cues.
export const subtitleClipsToCues = (project: Project): readonly SubtitleCue[] =>
  listSubtitleClips(project).map((c) => ({
    start: c.start,
    end: c.start + c.duration,
    text: c.kind === "text" ? c.text : "",
  }));
