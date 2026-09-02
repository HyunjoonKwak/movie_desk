"use client";

import { create } from "zustand";
import type { MediaImportFailure } from "./import-errors";

interface ImportFailureState {
  readonly failures: readonly MediaImportFailure[];
  add: (failure: MediaImportFailure) => void;
  remove: (ids: readonly string[]) => void;
  clear: () => void;
}

export const useImportFailureStore = create<ImportFailureState>((set) => ({
  failures: [],
  add: (failure) => set((state) => ({ failures: [...state.failures, failure] })),
  remove: (ids) => {
    const removed = new Set(ids);
    set((state) => ({ failures: state.failures.filter((failure) => !removed.has(failure.id)) }));
  },
  clear: () => set({ failures: [] }),
}));
