"use client";

import type { MediaAsset } from "@movie-desk/core";
import { create } from "zustand";
import { type SourceHealth, probeAssetSource } from "./source/probe-source";

// Remembers, per asset, whether its bytes were reachable the last time we
// looked, so the media bin can flag a missing original before the user
// discovers it in the preview or at export. Results are tied to the asset
// record that was probed: a relinked or rebuilt asset is probed again.

interface HealthEntry {
  readonly health: SourceHealth;
  readonly asset: MediaAsset;
  readonly checkedAt: number;
}

interface SourceHealthState {
  readonly entries: Readonly<Record<string, HealthEntry>>;
  // Probes assets that were never checked, changed since their check, or
  // whose check is older than `maxAgeMs` (all of them with `force`).
  check: (
    assets: readonly MediaAsset[],
    options?: { readonly force?: boolean; readonly maxAgeMs?: number },
  ) => Promise<void>;
  forget: (assetId: string) => void;
}

const CONCURRENCY = 4;
const DEFAULT_MAX_AGE_MS = 60_000;

let prober: (asset: MediaAsset) => Promise<SourceHealth> = probeAssetSource;
let clock: () => number = () => Date.now();

// Tests swap the prober and the clock; production never calls this.
export const configureSourceHealthForTests = (options: {
  readonly probe?: (asset: MediaAsset) => Promise<SourceHealth>;
  readonly now?: () => number;
}): void => {
  prober = options.probe ?? probeAssetSource;
  clock = options.now ?? (() => Date.now());
};

const needsCheck = (
  entry: HealthEntry | undefined,
  asset: MediaAsset,
  force: boolean,
  maxAgeMs: number,
  now: number,
): boolean => !entry || entry.asset !== asset || force || now - entry.checkedAt > maxAgeMs;

export const useSourceHealthStore = create<SourceHealthState>((set, get) => ({
  entries: {},
  check: async (assets, options = {}) => {
    const now = clock();
    const due = assets.filter((asset) =>
      needsCheck(
        get().entries[asset.id],
        asset,
        options.force ?? false,
        options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
        now,
      ),
    );
    if (due.length === 0) return;
    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        const health = await prober(asset);
        set((state) => ({
          entries: { ...state.entries, [asset.id]: { health, asset, checkedAt: clock() } },
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  },
  forget: (assetId) =>
    set((state) => {
      const { [assetId]: _dropped, ...entries } = state.entries;
      return { entries };
    }),
}));
