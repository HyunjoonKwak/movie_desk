"use client";

import { create } from "zustand";

type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveStore {
  state: SaveState;
  lastSavedAt: number | null;
  libraryError: boolean;
  setLibraryError: (failed: boolean) => void;
  setState: (state: SaveState) => void;
  markSaved: () => void;
}

export const useSaveStateStore = create<SaveStore>((set) => ({
  state: "idle",
  lastSavedAt: null,
  libraryError: false,
  setLibraryError: (failed) =>
    set((current) =>
      current.libraryError === failed
        ? current
        : {
            libraryError: failed,
            state: failed ? "error" : "saved",
            lastSavedAt: failed ? current.lastSavedAt : Date.now(),
          },
    ),
  setState: (state) => set((current) => ({ state: current.libraryError ? "error" : state })),
  markSaved: () =>
    set((current) => ({
      state: current.libraryError ? "error" : "saved",
      lastSavedAt: Date.now(),
    })),
}));
