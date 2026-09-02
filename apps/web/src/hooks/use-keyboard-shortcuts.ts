"use client";

import { type ClipboardEntry, nextEditPoint, prevEditPoint } from "@movie-desk/core";
import { useEffect } from "react";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useViewStore } from "@/stores/view-store";
import { useRangeStore } from "@/stores/range-store";
import { useClipboardStore } from "@/stores/clipboard-store";
import { useMediaUiStore } from "@/stores/media-ui-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { ZOOM_STEP, clampZoom } from "@/timeline/constants";
import { zoomToFit } from "@/timeline/zoom-to-fit";

const THREE_POINT_KEYS: Record<string, "append" | "insert" | "overwrite" | "connect"> = {
  KeyE: "append",
  KeyW: "insert",
  KeyD: "overwrite",
  KeyQ: "connect",
};

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
};

// Selected clips paired with their tracks, ordered as they appear on the
// timeline — the shape the clipboard and pasteClips expect.
const collectSelectedEntries = (): readonly ClipboardEntry[] => {
  const ids = useSelectionStore.getState().clipIds;
  if (ids.size === 0) return [];
  return useProjectStore
    .getState()
    .project.timeline.tracks.flatMap((tr) =>
      tr.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackId: tr.id, clip })),
    );
};

export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      // Radix menus / dialogs / listboxes own their keyboard interaction —
      // arrow-navigating a context menu must not scrub the playhead.
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('[role="menu"],[role="dialog"],[role="listbox"]')
      ) {
        return;
      }
      const cmd = e.metaKey || e.ctrlKey;

      // undo / redo
      if (cmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }
      if ((cmd && e.shiftKey && e.key.toLowerCase() === "z") || (cmd && e.key.toLowerCase() === "y")) {
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }

      // Cmd+= / Cmd+- — timeline zoom in / out (FCP).
      if (cmd && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const store = useProjectStore.getState();
        store.setZoomLevel(clampZoom(store.project.timeline.zoom * ZOOM_STEP));
        return;
      }
      if (cmd && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        const store = useProjectStore.getState();
        store.setZoomLevel(clampZoom(store.project.timeline.zoom / ZOOM_STEP));
        return;
      }

      // Cmd+C / Cmd+X / Cmd+V — clip clipboard. Cut ripples (magnetic, FCP);
      // paste lands at the playhead on the source tracks and selects the
      // pasted copies. A live text selection keeps the native clipboard.
      const hasTextSelection = !(window.getSelection()?.isCollapsed ?? true);
      if (cmd && e.key.toLowerCase() === "c" && !hasTextSelection) {
        const entries = collectSelectedEntries();
        if (entries.length === 0) return;
        e.preventDefault();
        useClipboardStore.getState().setEntries(entries);
        return;
      }
      if (cmd && e.key.toLowerCase() === "x" && !hasTextSelection) {
        const entries = collectSelectedEntries();
        if (entries.length === 0) return;
        e.preventDefault();
        useClipboardStore.getState().setEntries(entries);
        useProjectStore.getState().rippleDeleteClipsById(entries.map((en) => en.clip.id));
        useSelectionStore.getState().clear();
        return;
      }
      if (cmd && e.key.toLowerCase() === "v") {
        const entries = useClipboardStore.getState().entries;
        if (entries.length === 0) return;
        e.preventDefault();
        const store = useProjectStore.getState();
        const before = new Set(
          store.project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)),
        );
        store.pasteClipsAt(entries, store.project.timeline.playhead);
        const pasted = useProjectStore
          .getState()
          .project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id))
          .filter((id) => !before.has(id));
        if (pasted.length > 0) useSelectionStore.setState({ clipIds: new Set(pasted) });
        return;
      }

      // playback
      if (e.code === "Space") {
        e.preventDefault();
        usePlaybackStore.getState().toggle();
        return;
      }

      // J/K/L shuttle: K pauses, L plays forward (tap again to speed up),
      // J plays in reverse (tap again to speed up). Rate caps at ±8×.
      if (e.key === "l" && !cmd) {
        const pb = usePlaybackStore.getState();
        const rate = pb.playing && pb.rate > 0 ? Math.min(pb.rate * 2, 8) : 1;
        pb.setRate(rate);
        pb.setPlaying(true);
        return;
      }
      if (e.key === "j" && !cmd) {
        const pb = usePlaybackStore.getState();
        const rate = pb.playing && pb.rate < 0 ? Math.max(pb.rate * 2, -8) : -1;
        pb.setRate(rate);
        pb.setPlaying(true);
        return;
      }
      if (e.key === "k" && !cmd) {
        const pb = usePlaybackStore.getState();
        pb.setPlaying(false);
        pb.setRate(1);
        return;
      }

      // Shift+Z — fit the whole timeline into the viewport.
      if (e.key.toLowerCase() === "z" && e.shiftKey && !cmd) {
        e.preventDefault();
        zoomToFit();
        return;
      }

      // `n` — toggle edge snapping (FCP).
      if (e.key === "n" && !cmd) {
        useTimelineUiStore.getState().toggleSnap();
        return;
      }

      // E/W/D/Q — FCP three-point edit from the media bin's active source:
      // append to the end / insert with ripple / overwrite / connect above.
      // e.code, not e.key, so the keys work under a Korean IME layout; no
      // key-repeat — holding W must not machine-gun full-project snapshots.
      const threePointMode = THREE_POINT_KEYS[e.code];
      if (threePointMode && !cmd && !e.altKey && !e.shiftKey) {
        if (e.repeat) return;
        const assetId = useMediaUiStore.getState().activeAssetId;
        if (!assetId) return;
        const store = useProjectStore.getState();
        const asset = store.project.mediaLibrary.find((a) => a.id === assetId);
        if (!asset) return;
        store.placeAsset(asset, threePointMode);
        return;
      }

      // `m` — drop a marker at the playhead.
      if (e.key === "m" && !cmd) {
        const store = useProjectStore.getState();
        store.addMarkerAt(store.project.timeline.playhead);
        return;
      }

      // Cmd/Ctrl+B — blade: split every clip under the playhead, all tracks.
      if (cmd && e.key.toLowerCase() === "b") {
        e.preventDefault();
        const store = useProjectStore.getState();
        store.splitAllAt(store.project.timeline.playhead);
        return;
      }

      // Home / End — jump the playhead to the start / end of the timeline.
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const store = useProjectStore.getState();
        store.setPlayheadMs(e.key === "Home" ? 0 : store.project.timeline.duration);
        return;
      }

      // Ctrl+; / Ctrl+' — jump to the previous / next marker (FCP).
      // !altKey keeps AltGr (Ctrl+Alt) compositions on European layouts out.
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === ";" || e.key === "'")) {
        e.preventDefault();
        const proj = useProjectStore.getState().project;
        const markers = proj.timeline.markers ?? [];
        if (markers.length === 0) return;
        const at = proj.timeline.playhead;
        const sorted = [...markers].sort((a, b) => a.at - b.at);
        const target =
          e.key === "'"
            ? sorted.find((m) => m.at > at + 1)
            : [...sorted].reverse().find((m) => m.at < at - 1);
        if (target) useProjectStore.getState().setPlayheadMs(target.at);
        return;
      }

      // `,` / `.` — nudge the selected clips one frame left / right
      // (Shift = 10 frames), the FCP comma/period trim.
      if ((e.key === "," || e.key === "." || e.key === "<" || e.key === ">") && !cmd) {
        const ids = useSelectionStore.getState().clipIds;
        if (ids.size === 0) return;
        const store = useProjectStore.getState();
        const dir = e.key === "," || e.key === "<" ? -1 : 1;
        const delta = dir * (1000 / store.project.framerate) * (e.shiftKey ? 10 : 1);
        store.nudgeClipsBy([...ids], delta);
        return;
      }

      // ↑ / ↓ — jump the playhead to the previous / next edit point (FCP).
      // Cmd/Alt combos stay native (page scroll etc.).
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !cmd && !e.altKey) {
        e.preventDefault();
        const store = useProjectStore.getState();
        const at = store.project.timeline.playhead;
        const target =
          e.key === "ArrowUp"
            ? prevEditPoint(store.project.timeline, at)
            : nextEditPoint(store.project.timeline, at);
        if (target !== null) store.setPlayheadMs(target);
        return;
      }

      // delete — ripple delete, closing the gap (FCP magnetic default).
      // Shift+Delete lifts instead, leaving a gap in place. One undo entry
      // for the whole selection either way.
      if (e.key === "Backspace" || e.key === "Delete") {
        const ids = [...useSelectionStore.getState().clipIds];
        if (ids.length > 0) {
          e.preventDefault();
          const store = useProjectStore.getState();
          if (e.shiftKey) store.removeClipsById(ids);
          else store.rippleDeleteClipsById(ids);
          useSelectionStore.getState().clear();
        }
      }

      // in/out work-area points for ranged export — `i` / `o`
      if (e.key === "i" && !cmd) {
        useRangeStore.getState().setIn(useProjectStore.getState().project.timeline.playhead);
        return;
      }
      if (e.key === "o" && !cmd) {
        useRangeStore.getState().setOut(useProjectStore.getState().project.timeline.playhead);
        return;
      }

      // razor split at playhead — `s`
      if (e.key === "s" && !cmd) {
        const ids = useSelectionStore.getState().clipIds;
        const at = useProjectStore.getState().project.timeline.playhead;
        const store = useProjectStore.getState();
        for (const id of ids) store.splitAt(id, at);
      }

      // Cmd/Ctrl+G — group selected clips; +Shift ungroups.
      if (cmd && e.key.toLowerCase() === "g") {
        e.preventDefault();
        const ids = [...useSelectionStore.getState().clipIds];
        const store = useProjectStore.getState();
        if (e.shiftKey) {
          for (const id of ids) store.ungroupClip(id);
        } else if (ids.length >= 2) {
          store.groupSelected(ids);
        }
        return;
      }

      // Cmd/Ctrl+A — select every clip on every track
      if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const all = useProjectStore.getState().project.timeline.tracks.flatMap((t) =>
          t.clips.map((c) => c.id),
        );
        useSelectionStore.setState({ clipIds: new Set(all) });
      }

      // Arrow left/right. With a selection: clip edits — plain = nudge one
      // frame (Shift = 10 frames, FCP), Alt = roll the cut with the next
      // clip, Alt+Shift = slide between neighbours. Without a selection:
      // FCP-style playhead frame stepping (Shift = 10 frames).
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const ids = useSelectionStore.getState().clipIds;
        const store = useProjectStore.getState();
        const fps = store.project.framerate;
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (ids.size > 0) {
          if (e.altKey && e.shiftKey) {
            const delta = dir * (1000 / fps) * 5;
            for (const id of ids) store.slideClipBy(id, delta);
          } else if (e.altKey) {
            const delta = dir * (1000 / fps) * 5;
            for (const id of ids) store.rollEditBy(id, delta);
          } else {
            const delta = dir * (1000 / fps) * (e.shiftKey ? 10 : 1);
            store.nudgeClipsBy([...ids], delta);
          }
        } else {
          const delta = dir * (1000 / fps) * (e.shiftKey ? 10 : 1);
          store.setPlayheadMs(store.project.timeline.playhead + delta);
        }
        return;
      }

      // `?` — toggle the keyboard shortcut cheatsheet
      if (e.key === "?") {
        e.preventDefault();
        useViewStore.getState().toggleShortcuts();
        return;
      }

      // Esc — clear selection and close the cheatsheet
      if (e.key === "Escape") {
        useViewStore.getState().setShowShortcuts(false);
        useSelectionStore.getState().clear();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
};
