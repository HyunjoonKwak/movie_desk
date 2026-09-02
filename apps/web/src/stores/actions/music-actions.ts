import {
  addClip,
  addTrack,
  newId,
  recordApplied,
  resolvePlacement,
  type ID,
  type KeyframeTrack,
  type MediaClip,
} from "@movie-desk/core";
import type { ProjectMutating, SetFn } from "../store-helpers";

export interface MusicActions {
  // Returns false when nothing could be placed (unknown/non-audio asset,
  // or no room left under the program) so the UI can react honestly.
  addMusicBed: (assetId: ID) => boolean;
}

export const createMusicActions = <S extends ProjectMutating>(set: SetFn<S>): MusicActions => ({
  // Music bed: lay the audio asset on a dedicated "Music" track starting at
  // the first free spot, capped so it NEVER extends the program (a second
  // bed fills the remaining room instead of dangling past the video), with
  // an autoedit-style tail fade. Honours the asset's marked use-range.
  addMusicBed: (assetId) => {
    let placed = false;
    set((s) => {
      const p = s.project;
      const asset = p.mediaLibrary.find((a) => a.id === assetId);
      if (!asset || asset.kind !== "audio") return {} as Partial<S>;
      const inMs = asset.useInMs ?? 0;
      const outMs = asset.useOutMs ?? asset.durationMs;

      let proj = p;
      let track = proj.timeline.tracks.find(
        (t) => t.kind === "audio" && t.name === "Music" && !t.locked,
      );
      if (!track) {
        proj = addTrack(proj, {
          kind: "audio",
          name: "Music",
          height: 44,
          muted: false,
          solo: false,
          locked: false,
        });
        track = proj.timeline.tracks.at(-1)!;
      }

      const start = resolvePlacement(track.clips, 1, 0);
      const timelineMs = p.timeline.duration;
      const room = timelineMs > 0 ? timelineMs - start : Number.POSITIVE_INFINITY;
      const nextClipStart = track.clips.reduce(
        (m, c) => (c.start >= start && c.start < m ? c.start : m),
        Number.POSITIVE_INFINITY,
      );
      const dur = Math.min(outMs - inMs, room, nextClipStart - start);
      if (dur <= 0) return {} as Partial<S>;

      const fade: KeyframeTrack = {
        target: "volume",
        keyframes: [
          { at: Math.max(0, dur - 1500), value: 1, easing: "linear" },
          { at: dur, value: 0, easing: "linear" },
        ],
      };
      const bed: MediaClip = {
        kind: "media",
        id: newId(),
        assetId,
        start,
        duration: dur,
        speed: 1,
        trimIn: inMs,
        trimOut: inMs + dur,
        effects: [],
        keyframes: [fade],
        label: asset.name,
      };
      const after = addClip(proj, track.id, bed);
      placed = true;
      return {
        project: after,
        history: recordApplied(s.project, after, s.history, "Add music bed"),
      } as Partial<S>;
    });
    return placed;
  },
});
