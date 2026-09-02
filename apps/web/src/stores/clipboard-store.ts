import type { ClipboardEntry } from "@movie-desk/core";
import { create } from "zustand";

// In-app clip clipboard for Cmd+C/X/V. Session-only — deliberately not the
// OS clipboard: clips reference project-local asset ids that mean nothing
// outside this project.
interface ClipboardState {
  readonly entries: readonly ClipboardEntry[];
  setEntries: (entries: readonly ClipboardEntry[]) => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
}));
