import { addTrack, removeTrack, updateTrack, addClip, moveClipToTrack } from "@movie-desk/core";
import type { Clip, ID, TrackKind } from "@movie-desk/core";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

export interface TrackActions {
  addNewTrack: (kind: TrackKind) => void;
  removeTrackById: (trackId: ID) => void;
  toggleTrackMute: (trackId: ID) => void;
  toggleTrackSolo: (trackId: ID) => void;
  toggleTrackLock: (trackId: ID) => void;
  addClipToTrack: (trackId: ID, clip: Clip) => void;
  moveClipToOtherTrack: (clipId: ID, destTrackId: ID) => void;
}

export const createTrackActions = <S extends ProjectMutating>(set: SetFn<S>): TrackActions => ({
  addNewTrack: (kind) =>
    runWith(set, `Add ${kind} track`, (p) => {
      const sameKindCount = p.timeline.tracks.filter((t) => t.kind === kind).length;
      const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : kind === "text" ? "T" : "O";
      return addTrack(p, {
        kind,
        name: `${prefix}${sameKindCount + 1}`,
        height: kind === "audio" ? 48 : 60,
        muted: false,
        solo: false,
        locked: false,
      });
    }),

  removeTrackById: (trackId) =>
    runWith(set, "Remove track", (p) => removeTrack(p, trackId)),

  toggleTrackMute: (trackId) =>
    runWith(set, "Toggle mute", (p) =>
      updateTrack(p, trackId, (t) => ({ ...t, muted: !t.muted })),
    ),

  toggleTrackSolo: (trackId) =>
    runWith(set, "Toggle solo", (p) =>
      updateTrack(p, trackId, (t) => ({ ...t, solo: !t.solo })),
    ),

  toggleTrackLock: (trackId) =>
    runWith(set, "Toggle lock", (p) =>
      updateTrack(p, trackId, (t) => ({ ...t, locked: !t.locked })),
    ),

  addClipToTrack: (trackId, clip) =>
    runWith(set, "Add clip", (p) => addClip(p, trackId, clip)),

  moveClipToOtherTrack: (clipId, destTrackId) =>
    runWith(set, "Move clip to track", (p) => moveClipToTrack(p, clipId, destTrackId)),
});
