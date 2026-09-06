import { create } from "zustand";
import type { HeldLevel } from "@movie-desk/core";

export type LiveLevel = HeldLevel & { readonly shortLufs: number | null };
export const useMeterStore = create<{ levels: Readonly<Record<string, LiveLevel>>; live: boolean }>(
  () => ({ levels: {}, live: false }),
);
