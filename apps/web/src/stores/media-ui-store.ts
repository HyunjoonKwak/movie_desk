import type { ID } from "@movie-desk/core";
import { create } from "zustand";

// Transient media-bin UI state. `activeAssetId` is the source the E/W/D/Q
// three-point edit keys act on — the last asset the user touched in the
// bin (click, multi-select, or drag). Session-only, never persisted.
interface MediaUiState {
  readonly activeAssetId: ID | null;
  setActiveAssetId: (id: ID | null) => void;
}

export const useMediaUiStore = create<MediaUiState>((set) => ({
  activeAssetId: null,
  setActiveAssetId: (activeAssetId) => set({ activeAssetId }),
}));
