"use client";

import { create } from "zustand";

type SaveState = "idle" | "saving" | "saved";

interface SaveStore {
  state: SaveState;
  lastSavedAt: number | null;
  setState: (state: SaveState) => void;
  markSaved: () => void;
}

export const useSaveStateStore = create<SaveStore>((set) => ({
  state: "idle",
  lastSavedAt: null,
  setState: (state) => set({ state }),
  markSaved: () => set({ state: "saved", lastSavedAt: Date.now() }),
}));
