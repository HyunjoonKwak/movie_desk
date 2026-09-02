import { create } from "zustand";
import { persist } from "zustand/middleware";

// Loudness normalization settings applied at export. When enabled, the mixed
// audio is measured (BS.1770) and a single master gain is applied to bring its
// integrated loudness to `targetLufs`.
interface NormalizeState {
  readonly enabled: boolean;
  readonly targetLufs: number;
  setEnabled: (v: boolean) => void;
  setTargetLufs: (v: number) => void;
}

// Common targets: -14 (YouTube/Spotify), -16 (Apple/AES streaming), -23 (EBU R128 broadcast).
export const useNormalizeStore = create<NormalizeState>()(
  persist(
    (set) => ({
      enabled: false,
      targetLufs: -14,
      setEnabled: (v) => set({ enabled: v }),
      setTargetLufs: (v) => set({ targetLufs: v }),
    }),
    // Legacy key retained so user export preferences survive the rename.
    { name: "cut-editor:normalize" },
  ),
);
