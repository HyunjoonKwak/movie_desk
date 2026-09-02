import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaOrder } from "@/media/organize";

// Editor view preferences that are independent of the project document:
// overlay guides, media bin ordering. Persisted so they survive reloads.
interface ViewState {
  readonly showGuides: boolean;
  readonly showShortcuts: boolean;
  readonly mediaOrder: MediaOrder;
  readonly mediaGroupByDay: boolean;
  toggleGuides: () => void;
  setShowGuides: (v: boolean) => void;
  toggleShortcuts: () => void;
  setShowShortcuts: (v: boolean) => void;
  setMediaOrder: (order: MediaOrder) => void;
  toggleMediaGroupByDay: () => void;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      showGuides: false,
      showShortcuts: false,
      // Footage comes back organized by default: capture order, grouped by day.
      mediaOrder: "captured",
      mediaGroupByDay: true,
      toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
      setShowGuides: (v) => set({ showGuides: v }),
      toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
      setShowShortcuts: (v) => set({ showShortcuts: v }),
      setMediaOrder: (mediaOrder) => set({ mediaOrder }),
      toggleMediaGroupByDay: () => set((s) => ({ mediaGroupByDay: !s.mediaGroupByDay })),
    }),
    // The shortcuts overlay should always start closed, so it is not persisted.
    {
      name: "cut-editor:view",
      partialize: (s) => ({
        showGuides: s.showGuides,
        mediaOrder: s.mediaOrder,
        mediaGroupByDay: s.mediaGroupByDay,
      }),
    },
  ),
);
