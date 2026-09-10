import type { ID } from "@movie-desk/core";
import { create } from "zustand";

// Transient timeline interaction state — never persisted, never in undo
// history. `snapMs` drives the vertical snap guide while dragging clips;
// `dragAssetId` is the media-bin asset currently being dragged so tracks
// can render a drop preview (dataTransfer payloads are unreadable during
// dragover, hence the store). `snapEnabled` is the FCP `N` toggle for
// edge magnetism — frame snapping stays on regardless.
interface TimelineUiState {
  readonly activeTimelineId: ID | null;
  setActiveTimelineId: (id: ID | null) => void;
  readonly snapMs: number | null;
  readonly dragAssetId: string | null;
  readonly snapEnabled: boolean;
  /** Hover time under the skimmer, or null when not skimming. */
  readonly skimMs: number | null;
  setSnapMs: (ms: number | null) => void;
  setSkimMs: (ms: number | null) => void;
  setDragAssetId: (id: string | null) => void;
  toggleSnap: () => void;
}

export const useTimelineUiStore = create<TimelineUiState>((set) => ({
  activeTimelineId: null,
  setActiveTimelineId: (activeTimelineId) => set({ activeTimelineId, snapMs: null }),
  snapMs: null,
  dragAssetId: null,
  snapEnabled: true,
  skimMs: null,
  setSnapMs: (snapMs) => set({ snapMs }),
  setSkimMs: (skimMs) => set((s) => (s.skimMs === skimMs ? s : { skimMs })),
  setDragAssetId: (dragAssetId) => set({ dragAssetId }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled, snapMs: null })),
}));
