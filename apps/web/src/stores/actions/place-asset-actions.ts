import {
  addClip,
  addTrackAt,
  clipEnd,
  insertClipAt,
  newId,
  overwriteClipAt,
  recordApplied,
  snapMsToFrame,
  type MediaAsset,
  type MediaClip,
  type Ms,
  type Project,
  type Track,
} from "@movie-desk/core";
import type { ProjectMutating, SetFn } from "../store-helpers";

// FCP three-point edit modes: E append, W insert, D overwrite, Q connect.
export type PlaceMode = "append" | "insert" | "overwrite" | "connect";

export interface PlaceAssetActions {
  placeAsset: (asset: MediaAsset, mode: PlaceMode) => void;
}

const LABELS: Record<PlaceMode, string> = {
  append: "Append clip",
  insert: "Insert clip",
  overwrite: "Overwrite clip",
  connect: "Connect clip",
};

// Media clip from an asset, honouring its marked use-range. `start` is a
// placeholder — every mode positions the clip itself.
export const clipFromAsset = (asset: MediaAsset): MediaClip => {
  const inMs = asset.useInMs ?? 0;
  const outMs = asset.useOutMs ?? asset.durationMs;
  return {
    kind: "media",
    id: newId(),
    assetId: asset.id,
    start: 0,
    duration: Math.max(200, outMs - inMs),
    trimIn: inMs,
    trimOut: outMs,
    speed: 1,
    effects: [],
    keyframes: [],
  };
};

const assetTrackKind = (asset: MediaAsset): Track["kind"] =>
  asset.kind === "audio" ? "audio" : "video";

// Q: place on a connected lane ABOVE the primary — earlier array index
// composites on top — reusing the nearest free lane or inserting a new one
// directly above the primary. The primary storyline is never disturbed.
const connectClip = (p: Project, kind: Track["kind"], clip: MediaClip, at: Ms): Project => {
  const tracks = p.timeline.tracks;
  const primaryIdx = tracks.findIndex((t) => t.kind === kind && !t.connected);
  const isFree = (t: Track): boolean =>
    !t.locked && t.clips.every((c) => clipEnd(c) <= at || c.start >= at + clip.duration);
  for (let i = primaryIdx - 1; i >= 0; i--) {
    const t = tracks[i]!;
    if (t.kind === kind && t.connected && isFree(t)) {
      return addClip(p, t.id, { ...clip, start: at });
    }
  }
  const insertAt = Math.max(0, primaryIdx);
  const count = tracks.filter((t) => t.kind === kind).length;
  const withTrack = addTrackAt(
    p,
    {
      kind,
      name: `${kind === "audio" ? "A" : "V"}${count + 1}`,
      height: kind === "audio" ? 48 : 60,
      muted: false,
      solo: false,
      locked: false,
      connected: true,
    },
    insertAt,
  );
  const created = withTrack.timeline.tracks[insertAt]!;
  return addClip(withTrack, created.id, { ...clip, start: at });
};

const applyPlace = (p: Project, asset: MediaAsset, mode: PlaceMode): Project => {
  const kind = assetTrackKind(asset);
  const clip = clipFromAsset(asset);
  const at = Math.max(0, snapMsToFrame(p.timeline.playhead, p.framerate));
  if (mode === "connect") return connectClip(p, kind, clip, at);
  // Three-point edits target the primary (first non-connected) track.
  const track = p.timeline.tracks.find((t) => t.kind === kind && !t.connected && !t.locked);
  if (!track) return p;
  if (mode === "append") {
    const end = track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    return addClip(p, track.id, { ...clip, start: end });
  }
  if (mode === "insert") return insertClipAt(p, track.id, clip, at);
  return overwriteClipAt(p, track.id, clip, at);
};

export const createPlaceAssetActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): PlaceAssetActions => ({
  // No history entry when nothing changes (e.g. every candidate track is
  // locked) — a phantom undo step would also clear the redo stack.
  placeAsset: (asset, mode) =>
    set((s) => {
      const after = applyPlace(s.project, asset, mode);
      if (after === s.project) return {} as Partial<S>;
      return {
        project: after,
        history: recordApplied(s.project, after, s.history, LABELS[mode]),
      } as Partial<S>;
    }),
});
