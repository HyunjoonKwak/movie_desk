"use client";

import { create } from "zustand";

type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveStore {
  state: SaveState;
  lastSavedAt: number | null;
  libraryError: boolean;
  documentError: boolean;
  setDocumentError: (failed: boolean) => void;
  setLibraryError: (failed: boolean) => void;
  setState: (state: SaveState) => void;
  markSaved: () => void;
}

export const useSaveStateStore = create<SaveStore>((set) => ({
  state: "idle",
  lastSavedAt: null,
  libraryError: false,
  documentError: false,
  setDocumentError: (failed) =>
    set((current) => ({
      documentError: failed,
      state: failed || current.libraryError ? "error" : "idle",
    })),
  setLibraryError: (failed) =>
    set((current) =>
      current.libraryError === failed
        ? current
        : {
            libraryError: failed,
            state: failed || current.documentError ? "error" : "saved",
            lastSavedAt: failed ? current.lastSavedAt : Date.now(),
          },
    ),
  setState: (state) =>
    set((current) => ({ state: current.libraryError || current.documentError ? "error" : state })),
  markSaved: () =>
    set((current) => ({
      state: current.libraryError || current.documentError ? "error" : "saved",
      lastSavedAt: Date.now(),
    })),
}));
