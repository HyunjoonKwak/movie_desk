"use client";

import {
  type AppliedCommand,
  type BezierHandles,
  type BlendMode,
  type Clip,
  type ClipMask,
  type ClipTransform,
  type ClipboardEntry,
  type CommandHistory,
  type EasingFn,
  type ID,
  type KeyframeTrack,
  type Marker,
  type MediaAsset,
  type Ms,
  type MulticamAngle,
  type Project,
  type ShapeClip,
  type ShapeKind,
  type SpatialFit,
  type TextAlign,
  type TrackKind,
  type Transition,
  closeGapsOnTrack,
  createEmptyProject,
  createMulticamProgram,
  crossfadeWithPrevious,
  detachAudio,
  duplicateClip,
  emptyHistory,
  findClip,
  groupClips,
  magneticMove,
  moveClipOrGroup,
  pasteClips,
  recordApplied,
  redo as redoHistory,
  removeClip,
  resolvePlacement,
  rippleDeleteClip,
  rollEdit,
  setClipBlendMode,
  setClipFreeze,
  setClipMask,
  setClipTransform,
  setPlayhead,
  setTransitionIn,
  setTransitionOut,
  setZoom,
  slideClip,
  slipClip,
  snapClipStart,
  snapMsToFrame,
  splitClipAt,
  switchAngleAt,
  toggleClipDisabled,
  trimClipEnd,
  trimClipStart,
  undo as undoHistory,
  ungroupClips,
  updateClip,
} from "@movie-desk/core";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { type TitleTemplate, createClipCreateActions } from "./actions/clip-create-actions";
import { createEffectActions } from "./actions/effect-actions";
import { createKeyframeActions } from "./actions/keyframe-actions";
import { createMarkerActions } from "./actions/marker-actions";
import { type CollectionActions, createCollectionActions } from "./actions/collection-actions";
import { type LibraryMarkActions, createLibraryMarkActions } from "./actions/library-marks-actions";
import { type RelinkAssetPatch, createMediaActions } from "./actions/media-actions";
import { createMusicActions } from "./actions/music-actions";
import { type PlaceMode, createPlaceAssetActions } from "./actions/place-asset-actions";
import { createTrackActions } from "./actions/track-actions";
import { runWith } from "./store-helpers";
import { useTimelineUiStore } from "./timeline-ui-store";

interface ProjectStoreState extends LibraryMarkActions, CollectionActions {
  project: Project;
  history: CommandHistory;

  // mutations
  loadProject: (p: Project) => void;
  // Commit a whole generated timeline (auto-edit) as ONE undoable command.
  applyGenerated: (label: string, build: (p: Project) => Project) => void;
  renameProject: (name: string) => void;
  setResolution: (w: number, h: number) => void;
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: ID) => void;
  relinkMediaAsset: (assetId: ID, patch: RelinkAssetPatch) => void;
  setAssetProxy: (
    assetId: ID,
    proxy: { proxyPath: string; proxyWidth: number; proxyHeight: number },
  ) => void;
  // 사용 구간 지정 — undefined 전달 시 구간 해제(전체 사용).
  setAssetUseRange: (assetId: ID, range: { inMs: Ms; outMs: Ms } | undefined) => void;
  dropInlinePreviews: (assetIds: readonly ID[]) => void;
  addNewTrack: (kind: TrackKind) => void;
  addTextClipAtPlayhead: (text?: string) => void;
  addShapeClipAtPlayhead: (shape: ShapeKind) => void;
  addAdjustmentClipAtPlayhead: () => void;
  addTitleTemplate: (kind: TitleTemplate) => void;
  updateShapeClip: (
    clipId: ID,
    patch: Partial<
      Pick<
        ShapeClip,
        | "shape"
        | "fill"
        | "stroke"
        | "strokeWidth"
        | "cornerRadius"
        | "fillType"
        | "fillColor2"
        | "gradientAngle"
      >
    >,
  ) => void;
  updateTextClip: (
    clipId: ID,
    patch: {
      text?: string;
      size?: number;
      color?: string;
      bgColor?: string | undefined;
      font?: string;
      weight?: number;
      align?: TextAlign;
      strokeColor?: string;
      strokeWidth?: number;
      shadow?: boolean;
      shadowBlur?: number;
      animIn?: string;
      animOut?: string;
      animMs?: number;
    },
  ) => void;
  removeTrackById: (trackId: ID) => void;
  toggleTrackMute: (trackId: ID) => void;
  toggleTrackLock: (trackId: ID) => void;
  toggleTrackSolo: (trackId: ID) => void;
  addClipToTrack: (trackId: ID, clip: Clip) => void;
  placeAsset: (asset: MediaAsset, mode: PlaceMode) => void;
  addMusicBed: (assetId: ID) => boolean;
  removeClipById: (clipId: ID) => void;
  removeClipsById: (clipIds: readonly ID[]) => void;
  rippleDeleteById: (clipId: ID) => void;
  rippleDeleteClipsById: (clipIds: readonly ID[]) => void;
  closeGapsForClip: (clipId: ID) => void;
  slipClipBy: (clipId: ID, deltaMs: Ms) => void;
  rollEditBy: (clipId: ID, deltaMs: Ms) => void;
  slideClipBy: (clipId: ID, deltaMs: Ms) => void;
  crossfadeWith: (clipId: ID, durationMs?: Ms) => void;
  detachAudioFrom: (clipId: ID) => void;
  upsertEffectFor: (
    clipId: ID,
    type: string,
    params: Record<string, number | string | boolean>,
  ) => void;
  toggleClipDisabledById: (clipId: ID) => void;
  toggleFreezeAtPlayhead: (clipId: ID) => void;
  nudgeClipsBy: (clipIds: readonly ID[], deltaMs: Ms) => void;
  // Drag session — transient magnetic moves committed as ONE undo step.
  beginClipDrag: () => void;
  dragClipTo: (clipId: ID, targetStartMs: Ms) => void;
  endClipDrag: () => void;
  groupSelected: (clipIds: readonly ID[]) => void;
  ungroupClip: (clipId: ID) => void;
  moveClipToOtherTrack: (clipId: ID, destTrackId: ID) => void;
  trimEnd: (clipId: ID, newEnd: Ms) => void;
  trimStart: (clipId: ID, newStart: Ms) => void;
  setClipStartMs: (clipId: ID, startMs: Ms) => void;
  splitAt: (clipId: ID, at: Ms) => void;
  splitAllAt: (at: Ms) => void;
  setTransform: (clipId: ID, patch: Partial<ClipTransform>) => void;
  setMask: (clipId: ID, mask: ClipMask | undefined) => void;
  setBlendMode: (clipId: ID, mode: BlendMode | undefined) => void;
  createMulticam: (angles: readonly MulticamAngle[], durationMs: Ms) => void;
  switchMulticamAngle: (atMs: Ms, angle: MulticamAngle) => void;
  setTransitionInFor: (clipId: ID, transition: Transition | undefined) => void;
  setTransitionOutFor: (clipId: ID, transition: Transition | undefined) => void;
  duplicateClipById: (clipId: ID) => void;
  pasteClipsAt: (entries: readonly ClipboardEntry[], atMs: Ms) => void;
  reorderEffectById: (clipId: ID, effectId: ID, toIndex: number) => void;
  addMarkerAt: (atMs: Ms, label?: string) => void;
  removeMarkerById: (markerId: ID) => void;
  updateMarkerById: (markerId: ID, patch: Partial<Omit<Marker, "id">>) => void;
  addKeyframe: (clipId: ID, target: string, atMs: Ms, value: number) => void;
  removeKeyframe: (clipId: ID, target: string, atMs: Ms) => void;
  clearKeyframeTrack: (clipId: ID, target: string) => void;
  pasteKeyframesTo: (clipId: ID, tracks: readonly KeyframeTrack[]) => void;
  setKeyframeEasing: (
    clipId: ID,
    target: string,
    atMs: Ms,
    easing: EasingFn,
    bezier?: BezierHandles,
  ) => void;
  setClipSpeed: (clipId: ID, speed: number) => void;
  setClipVolume: (clipId: ID, volume: number) => void;
  setClipFit: (clipId: ID, fit: SpatialFit) => void;
  addEffect: (clipId: ID, type: string) => void;
  removeEffect: (clipId: ID, effectId: ID) => void;
  setEffectParamValue: (
    clipId: ID,
    effectId: ID,
    key: string,
    value: number | string | boolean,
  ) => void;
  toggleEffect: (clipId: ID, effectId: ID) => void;
  setPlayheadMs: (ms: Ms) => void;
  setZoomLevel: (zoom: number) => void;

  // history
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// Project snapshot captured at clip-drag start. Module-scoped on purpose:
// it is transient gesture state, never rendered and never persisted.
let clipDragBefore: Project | null = null;

// Key-repeat nudge session: consecutive nudges of the same selection within
// this window merge into the last undo entry, so holding `.` for a second
// costs one undo step (and one history snapshot pair), not thirty. The
// session pins the exact history entry it may extend — identity, not label,
// so an undo (or any other edit) in between can never be merged over.
let nudgeSession: { key: string; at: number; entry: AppliedCommand } | null = null;
const NUDGE_COALESCE_MS = 800;

// Pure nudge: move each selected clip/group by `deltaMs`. A group moves
// once, not once per selected member. Processed in timeline order —
// trailing clip first when moving right — so adjacent selected clips
// don't collide with each other and tear apart.
const applyNudge = (p: Project, clipIds: readonly ID[], deltaMs: Ms): Project => {
  const seen = new Set<ID>();
  const targets = p.timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => clipIds.includes(c.id))
    .sort((a, b) => (deltaMs > 0 ? b.start - a.start : a.start - b.start))
    .filter((c) => {
      const key = c.groupId ?? c.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return targets.reduce((proj, t) => {
    const clip = findClip(proj.timeline, t.id);
    if (!clip) return proj;
    const target = Math.max(0, clip.start + deltaMs);
    // Grouped clips move rigidly together by the delta.
    if (clip.groupId) return moveClipOrGroup(proj, t.id, target - clip.start);
    // Magnetic rule: clips on a track never overlap — clamp into the
    // nearest free gap.
    const track = proj.timeline.tracks.find((tr) => tr.clips.some((c) => c.id === t.id));
    const resolved = track ? resolvePlacement(track.clips, clip.duration, target, t.id) : target;
    return updateClip(proj, t.id, (c) => ({ ...c, start: resolved }));
  }, p);
};

export const useProjectStore = create<ProjectStoreState>()(
  subscribeWithSelector((set, get) => ({
    project: createEmptyProject(),
    history: emptyHistory,

    loadProject: (p) => {
      nudgeSession = null;
      set({ project: p, history: emptyHistory });
    },

    applyGenerated: (label, build) => runWith(set, label, build),

    renameProject: (name) =>
      runWith(set, "Rename project", (p) => ({ ...p, name: name.slice(0, 80) || "Untitled" })),

    setResolution: (w, h) =>
      runWith(set, "Reframe project", (p) => ({
        ...p,
        resolution: { w: Math.max(16, Math.round(w)), h: Math.max(16, Math.round(h)) },
      })),

    ...createMediaActions(set),
    ...createLibraryMarkActions(set),
    ...createCollectionActions(set),
    ...createMusicActions(set),
    ...createPlaceAssetActions(set),
    ...createTrackActions(set),
    ...createMarkerActions(set),
    ...createKeyframeActions(set),
    ...createEffectActions(set),
    ...createClipCreateActions(set),

    // Drag session: all pointer-move updates are computed from the project
    // captured at drag start (idempotent magnetics, no per-pixel history)
    // and committed as a single undo entry on pointer-up.
    beginClipDrag: () => {
      clipDragBefore = get().project;
    },

    dragClipTo: (clipId, targetStartMs) => {
      const before = clipDragBefore;
      if (!before) return;
      const clip = findClip(before.timeline, clipId);
      if (!clip) return;
      const target = Math.max(0, targetStartMs);
      const tol = 8 / Math.max(before.timeline.zoom, 0.001);
      const snapping = useTimelineUiStore.getState().snapEnabled;
      const snapped = snapping
        ? snapClipStart(before.timeline, clip, target, { toleranceMs: tol })
        : target;
      useTimelineUiStore.getState().setSnapMs(snapped !== target ? snapped : null);
      const framed = snapMsToFrame(snapped, before.framerate);
      if (clip.groupId) {
        // Rigid group move from the snapshot; groups don't push neighbours.
        set({ project: moveClipOrGroup(before, clipId, framed - clip.start) });
        return;
      }
      const tracks = before.timeline.tracks.map((t) =>
        t.clips.some((c) => c.id === clipId)
          ? { ...t, clips: magneticMove(t.clips, clipId, framed) }
          : t,
      );
      set({
        project: {
          ...before,
          updatedAt: Date.now(),
          timeline: { ...before.timeline, tracks },
        },
      });
    },

    endClipDrag: () => {
      const before = clipDragBefore;
      clipDragBefore = null;
      useTimelineUiStore.getState().setSnapMs(null);
      if (!before) return;
      const after = get().project;
      if (after === before) return;
      set((s) => ({ history: recordApplied(before, after, s.history, "Move clip") }));
    },

    // Keyboard nudge (`,`/`.`/arrows): one undoable command for the whole
    // selection, no edge snapping — a one-frame nudge must never
    // re-magnetise to the edge it just left (snap tolerance can exceed a
    // frame at low zoom). Rapid repeats coalesce into one undo entry.
    nudgeClipsBy: (clipIds, deltaMs) => {
      if (clipIds.length === 0 || deltaMs === 0) return;
      set((s) => {
        const after = applyNudge(s.project, clipIds, deltaMs);
        if (after === s.project) return {};
        const key = [...clipIds].sort().join("|");
        const now = Date.now();
        const last = s.history.past[s.history.past.length - 1];
        // Merge only when this is provably a continuation: same selection,
        // inside the window, the last entry is the exact one this session
        // recorded, and no other edit landed in between.
        const continues =
          nudgeSession !== null &&
          nudgeSession.key === key &&
          now - nudgeSession.at < NUDGE_COALESCE_MS &&
          last !== undefined &&
          last === nudgeSession.entry &&
          last.after === s.project;
        const history: CommandHistory = continues
          ? { past: [...s.history.past.slice(0, -1), { ...last, after, at: now }], future: [] }
          : recordApplied(s.project, after, s.history, "Nudge clip");
        nudgeSession = { key, at: now, entry: history.past[history.past.length - 1]! };
        return { project: after, history };
      });
    },

    groupSelected: (clipIds) => runWith(set, "Group clips", (p) => groupClips(p, clipIds)),

    ungroupClip: (clipId) => runWith(set, "Ungroup clips", (p) => ungroupClips(p, clipId)),

    removeClipById: (clipId) => runWith(set, "Delete clip", (p) => removeClip(p, clipId)),

    removeClipsById: (clipIds) => {
      if (clipIds.length === 0) return;
      runWith(set, "Delete clips", (p) => clipIds.reduce((proj, id) => removeClip(proj, id), p));
    },

    rippleDeleteById: (clipId) => runWith(set, "Ripple delete", (p) => rippleDeleteClip(p, clipId)),

    rippleDeleteClipsById: (clipIds) => {
      if (clipIds.length === 0) return;
      runWith(set, "Ripple delete", (p) =>
        clipIds.reduce((proj, id) => rippleDeleteClip(proj, id), p),
      );
    },

    closeGapsForClip: (clipId) =>
      runWith(set, "Close gaps", (p) => {
        const track = p.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
        return track ? closeGapsOnTrack(p, track.id) : p;
      }),

    trimEnd: (clipId, newEnd) => runWith(set, "Trim clip", (p) => trimClipEnd(p, clipId, newEnd)),

    trimStart: (clipId, newStart) =>
      runWith(set, "Trim clip", (p) => trimClipStart(p, clipId, newStart)),

    // Exact (typed) clip start — frame-snapped but free of edge snapping,
    // unlike moveClipBy which magnetises to neighbours while dragging.
    setClipStartMs: (clipId, startMs) =>
      runWith(set, "Set clip start", (p) =>
        updateClip(p, clipId, (c) => ({
          ...c,
          start: Math.max(0, snapMsToFrame(startMs, p.framerate)),
        })),
      ),

    rollEditBy: (clipId, deltaMs) => runWith(set, "Roll edit", (p) => rollEdit(p, clipId, deltaMs)),

    slideClipBy: (clipId, deltaMs) =>
      runWith(set, "Slide clip", (p) => slideClip(p, clipId, deltaMs)),

    crossfadeWith: (clipId, durationMs = 500) =>
      runWith(set, "Audio crossfade", (p) => crossfadeWithPrevious(p, clipId, durationMs)),

    detachAudioFrom: (clipId) => runWith(set, "Detach audio", (p) => detachAudio(p, clipId)),

    slipClipBy: (clipId, deltaMs) =>
      // No history entry for smooth slider drags; mirrors setTransform.
      set((s) => {
        const clip = s.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
        const asset =
          clip && clip.kind === "media"
            ? s.project.mediaLibrary.find((a) => a.id === clip.assetId)
            : undefined;
        const maxSource = asset?.durationMs ?? Number.POSITIVE_INFINITY;
        return { project: slipClip(s.project, clipId, deltaMs, maxSource) };
      }),

    toggleClipDisabledById: (clipId) =>
      runWith(set, "Toggle clip", (p) => toggleClipDisabled(p, clipId)),

    toggleFreezeAtPlayhead: (clipId) =>
      runWith(set, "Freeze frame", (p) => {
        const clip = p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
        if (!clip || clip.kind !== "media") return p;
        if (clip.freeze !== undefined) return setClipFreeze(p, clipId, undefined);
        const srcMs = clip.trimIn + (p.timeline.playhead - clip.start) * clip.speed;
        const held = Math.max(clip.trimIn, Math.min(srcMs, clip.trimOut));
        return setClipFreeze(p, clipId, held);
      }),

    splitAt: (clipId, at) => runWith(set, "Split clip", (p) => splitClipAt(p, clipId, at)),

    // FCP-style blade-all (Cmd+B): split every clip under `at` on every
    // track in a single undoable command. No-op (and no history entry)
    // when the playhead isn't over any clip.
    splitAllAt: (at) => {
      const hit = get().project.timeline.tracks.some((t) =>
        t.clips.some((c) => at > c.start && at < c.start + c.duration),
      );
      if (!hit) return;
      runWith(set, "Blade all tracks", (p) => {
        const ids = p.timeline.tracks.flatMap((t) =>
          t.clips.filter((c) => at > c.start && at < c.start + c.duration).map((c) => c.id),
        );
        return ids.reduce((proj, id) => splitClipAt(proj, id, at), p);
      });
    },

    setTransform: (clipId, patch) =>
      // Skip history entry for smooth slider drags.
      set((s) => ({ project: setClipTransform(s.project, clipId, patch) })),

    setMask: (clipId, mask) => runWith(set, "Set mask", (p) => setClipMask(p, clipId, mask)),

    setBlendMode: (clipId, mode) =>
      runWith(set, "Set blend mode", (p) => setClipBlendMode(p, clipId, mode)),

    createMulticam: (angles, durationMs) =>
      runWith(set, "Create multicam", (p) => createMulticamProgram(p, angles, durationMs).project),
    switchMulticamAngle: (atMs, angle) =>
      runWith(set, "Switch angle", (p) => switchAngleAt(p, atMs, angle)),

    setTransitionInFor: (clipId, transition) =>
      runWith(set, "Set transition in", (p) => setTransitionIn(p, clipId, transition)),
    setTransitionOutFor: (clipId, transition) =>
      runWith(set, "Set transition out", (p) => setTransitionOut(p, clipId, transition)),

    duplicateClipById: (clipId) => runWith(set, "Duplicate clip", (p) => duplicateClip(p, clipId)),

    // No history entry when nothing pastes (e.g. the source tracks are gone
    // after a project switch) — a phantom undo step would also clear redo.
    pasteClipsAt: (entries, atMs) =>
      set((s) => {
        const after = pasteClips(s.project, entries, atMs);
        if (after === s.project) return {};
        return {
          project: after,
          history: recordApplied(s.project, after, s.history, "Paste clips"),
        };
      }),

    setClipSpeed: (clipId, speed) =>
      runWith(set, "Set speed", (p) =>
        updateClip(p, clipId, (c) => ({ ...c, speed: Math.max(0.1, speed) })),
      ),

    setClipFit: (clipId, fit) =>
      runWith(set, "Set fit", (p) =>
        updateClip(p, clipId, (c) => (c.kind === "media" ? { ...c, fit } : c)),
      ),

    setClipVolume: (clipId, volume) =>
      // No history entry for smooth slider drags.
      set((s) => ({
        project: updateClip(s.project, clipId, (c) =>
          c.kind === "media" ? { ...c, volume: Math.max(0, Math.min(4, volume)) } : c,
        ),
      })),

    // Playhead and zoom are transient — no history entry to avoid bloat.
    setPlayheadMs: (ms) => set((s) => ({ project: setPlayhead(s.project, ms) })),
    setZoomLevel: (zoom) => set((s) => ({ project: setZoom(s.project, zoom) })),

    undo: () =>
      set((s) => {
        const r = undoHistory(s.project, s.history);
        return { project: r.project, history: r.history };
      }),
    redo: () =>
      set((s) => {
        const r = redoHistory(s.project, s.history);
        return { project: r.project, history: r.history };
      }),
    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0,
  })),
);

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __cutStore: typeof useProjectStore }).__cutStore = useProjectStore;
}

// convenient memo-less selectors
export const selectPlayhead = (s: ProjectStoreState): Ms => s.project.timeline.playhead;
export const selectZoom = (s: ProjectStoreState): number => s.project.timeline.zoom;
export const selectDuration = (s: ProjectStoreState): Ms => s.project.timeline.duration;
