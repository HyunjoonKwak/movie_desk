import { create } from "zustand";
import type { KeyframeTrack } from "@movie-desk/core";

// Transient clipboard for copying a clip's keyframe tracks onto another clip.
interface KeyframeClipboardState {
  readonly tracks: readonly KeyframeTrack[] | null;
  copy: (tracks: readonly KeyframeTrack[]) => void;
  clear: () => void;
}

export const useKeyframeClipboard = create<KeyframeClipboardState>((set) => ({
  tracks: null,
  // Deep-clone so later edits to the source clip don't mutate the clipboard.
  copy: (tracks) => set({ tracks: JSON.parse(JSON.stringify(tracks)) as KeyframeTrack[] }),
  clear: () => set({ tracks: null }),
}));
