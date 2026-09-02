"use client";

import { create } from "zustand";
import type { ID } from "@movie-desk/core";

interface SelectionState {
  clipIds: ReadonlySet<ID>;
  trackId: ID | null;

  select: (id: ID, additive?: boolean) => void;
  selectMany: (ids: readonly ID[]) => void;
  selectTrack: (id: ID | null) => void;
  clear: () => void;
  isSelected: (id: ID) => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  clipIds: new Set(),
  trackId: null,

  select: (id, additive = false) =>
    set((s) => {
      const next = new Set(additive ? s.clipIds : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { clipIds: next };
    }),

  selectMany: (ids) => set({ clipIds: new Set(ids) }),

  selectTrack: (id) => set({ trackId: id }),

  clear: () => set({ clipIds: new Set(), trackId: null }),

  isSelected: (id) => get().clipIds.has(id),
}));
