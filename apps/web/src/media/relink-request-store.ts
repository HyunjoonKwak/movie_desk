import { create } from "zustand";
import type { DesktopRelinkCandidate } from "./desktop-relink";

/**
 * The relink dialog lives in the media bin, but a disconnected location is
 * discovered in the locations panel. This carries the chosen candidates from
 * one to the other rather than giving the dialog a second owner.
 */
interface RelinkRequestState {
  readonly rows: readonly DesktopRelinkCandidate[] | null;
  request(rows: readonly DesktopRelinkCandidate[]): void;
  clear(): void;
}

export const useRelinkRequestStore = create<RelinkRequestState>((set) => ({
  rows: null,
  request: (rows) => set({ rows: rows.length ? rows : null }),
  clear: () => set({ rows: null }),
}));
