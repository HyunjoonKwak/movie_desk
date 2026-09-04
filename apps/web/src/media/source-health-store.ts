"use client";

import type { MediaAsset } from "@movie-desk/core";
import { create } from "zustand";
import { type SourceHealth, isSourceMissing, probeAssetSource } from "./source/probe-source";

// Remembers, per asset, whether its bytes were reachable the last time we
// looked, so the media bin can flag a missing original before the user
// discovers it in the preview or at export. Results are tied to the asset
// record that was probed: a relinked or rebuilt asset is probed again.

interface HealthEntry {
  readonly health: SourceHealth;
  readonly asset: MediaAsset;
  readonly checkedAt: number;
}

export interface CheckOptions {
  // Re-probe assets whose last check is older than this (default 60 s).
  readonly maxAgeMs?: number;
  // Re-probe everything, at most once per FORCE_THROTTLE_MS.
  readonly force?: boolean;
  // `assets` is the whole library: drop entries for anything not in it.
  // Callers passing a subset (the preview) must leave this off.
  readonly prune?: boolean;
}

interface SourceHealthState {
  readonly entries: Readonly<Record<string, HealthEntry>>;
  // Probes what is due among `assets`. Concurrent calls never probe the same
  // asset twice.
  check: (assets: readonly MediaAsset[], options?: CheckOptions) => Promise<void>;
}

const CONCURRENCY = 4;
const DEFAULT_MAX_AGE_MS = 60_000;
// A forced pass (window focus) costs a read per asset — on the desktop a
// lease plus a ranged request — so bursts of focus events share one pass.
export const FORCE_THROTTLE_MS = 10_000;
const FLUSH_EVERY = 32;

let prober: (asset: MediaAsset) => Promise<SourceHealth> = probeAssetSource;
let clock: () => number = () => Date.now();
const inFlight = new Set<string>();
let lastForcedAt = Number.NEGATIVE_INFINITY;

// Tests swap the prober and the clock; production never calls this.
export const configureSourceHealthForTests = (options: {
  readonly probe?: (asset: MediaAsset) => Promise<SourceHealth>;
  readonly now?: () => number;
}): void => {
  prober = options.probe ?? probeAssetSource;
  clock = options.now ?? (() => Date.now());
  inFlight.clear();
  lastForcedAt = Number.NEGATIVE_INFINITY;
};

const isDue = (
  entry: HealthEntry | undefined,
  asset: MediaAsset,
  force: boolean,
  maxAgeMs: number,
  now: number,
): boolean => !entry || entry.asset !== asset || force || now - entry.checkedAt > maxAgeMs;

const withoutStale = (
  entries: Readonly<Record<string, HealthEntry>>,
  assets: readonly MediaAsset[],
): Readonly<Record<string, HealthEntry>> => {
  const keep = new Set<string>(assets.map((asset) => asset.id));
  if (Object.keys(entries).every((id) => keep.has(id))) return entries;
  return Object.fromEntries(Object.entries(entries).filter(([id]) => keep.has(id)));
};

export const useSourceHealthStore = create<SourceHealthState>((set, get) => ({
  entries: {},
  check: async (assets, options = {}) => {
    const now = clock();
    let force = options.force ?? false;
    if (force) {
      if (now - lastForcedAt < FORCE_THROTTLE_MS) force = false;
      else lastForcedAt = now;
    }
    const pruned = options.prune ? withoutStale(get().entries, assets) : get().entries;
    if (pruned !== get().entries) set({ entries: pruned });

    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const due = assets.filter(
      (asset) => !inFlight.has(asset.id) && isDue(pruned[asset.id], asset, force, maxAgeMs, now),
    );
    if (due.length === 0) return;
    // Assets already flagged missing go first so a reconnected drive clears
    // its badges before the healthy majority is re-checked.
    const queue = [
      ...due.filter((asset) => isSourceMissing(pruned[asset.id]?.health)),
      ...due.filter((asset) => !isSourceMissing(pruned[asset.id]?.health)),
    ];
    for (const asset of queue) inFlight.add(asset.id);

    let batch: Record<string, HealthEntry> = {};
    const flush = () => {
      const results = batch;
      batch = {};
      if (Object.keys(results).length === 0) return;
      set((state) => ({
        entries: Object.fromEntries(
          Object.entries({ ...state.entries, ...results }).filter(
            // A result older than what is stored (an overlapping pass that
            // started earlier) must not overwrite a newer verdict.
            ([id, entry]) =>
              !(id in results) || entry.checkedAt >= (state.entries[id]?.checkedAt ?? 0),
          ),
        ),
      }));
    };
    const worker = async (): Promise<void> => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        const startedAt = clock();
        try {
          const health = await prober(asset);
          batch = { ...batch, [asset.id]: { health, asset, checkedAt: startedAt } };
        } finally {
          inFlight.delete(asset.id);
        }
        if (Object.keys(batch).length >= FLUSH_EVERY) flush();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    } finally {
      flush();
    }
  },
}));
