"use client";

import type { ID } from "@movie-desk/core";
import { create } from "zustand";
import { useMediaUiStore } from "./media-ui-store";
import { usePlaybackStore } from "./playback-store";

// The viewer shows either the timeline or one source asset. This transient
// state names the asset and carries its own transport, so browsing footage
// never moves the timeline playhead. Session-only, never persisted.
interface SourceViewerState {
  readonly assetId: ID | null;
  readonly playheadMs: number;
  readonly playing: boolean;
  readonly rate: number;
  // Transient: the asset and time under the pointer while skimming a card.
  readonly skimAssetId: ID | null;
  readonly skimMs: number;
  show: (assetId: ID, atMs?: number) => void;
  skim: (assetId: ID, ms: number) => void;
  clearSkim: () => void;
  close: () => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  toggle: () => void;
  setRate: (rate: number) => void;
}

export const useSourceViewerStore = create<SourceViewerState>((set, get) => ({
  assetId: null,
  playheadMs: 0,
  playing: false,
  rate: 1,
  skimAssetId: null,
  skimMs: 0,
  skim: (assetId, ms) =>
    set((s) => {
      const skimMs = Math.max(0, Math.round(ms));
      return s.skimAssetId === assetId && s.skimMs === skimMs
        ? s
        : { skimAssetId: assetId, skimMs };
    }),
  clearSkim: () => set((s) => (s.skimAssetId === null ? s : { skimAssetId: null, skimMs: 0 })),
  show: (assetId, atMs) => {
    // The shown source is also what E/W/D/Q place.
    useMediaUiStore.getState().setActiveAssetId(assetId);
    set((s) =>
      s.assetId === assetId && atMs === undefined
        ? s
        : { assetId, playheadMs: Math.max(0, Math.round(atMs ?? 0)), playing: false, rate: 1 },
    );
  },
  close: () => set({ assetId: null, playing: false, rate: 1, skimAssetId: null, skimMs: 0 }),
  setPlayhead: (ms) =>
    set((s) => {
      const playheadMs = Math.max(0, Math.round(ms));
      return s.playheadMs === playheadMs ? s : { playheadMs };
    }),
  setPlaying: (playing) => {
    if (playing && get().assetId === null) return;
    // One transport at a time: the source and the timeline never play together.
    if (playing && usePlaybackStore.getState().playing)
      usePlaybackStore.getState().setPlaying(false);
    set((s) => (s.playing === playing ? s : { playing }));
  },
  toggle: () => get().setPlaying(!get().playing),
  setRate: (rate) => set({ rate }),
}));

usePlaybackStore.subscribe((state, previous) => {
  if (state.playing && !previous.playing) useSourceViewerStore.getState().setPlaying(false);
});
