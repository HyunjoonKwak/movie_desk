"use client";

import { create } from "zustand";
import type { ID, MediaAsset } from "@movie-desk/core";
import type { AnalysisEntry, AssetAnalysis } from "./types";
import { analyzeAsset } from "./analyzer";

// Transient, derived data — deliberately NOT part of the CRDT project. It is
// recomputed in the background after load/import; the auto-edit wizard reads
// from here. One asset analyses at a time to keep decode pressure low.

interface AnalysisState {
  entries: Record<ID, AnalysisEntry>;
  queue: readonly ID[];
  running: boolean;
  enqueue: (assets: readonly MediaAsset[]) => void;
  get: (assetId: ID) => AnalysisEntry | undefined;
  reset: () => void;
}

let assetLookup: ((id: ID) => MediaAsset | undefined) | null = null;
// Aborts the in-flight analysis on reset so a closed project stops decoding.
let inflight: AbortController | null = null;
// A reset followed by enqueue starts a new pump while the old one is still
// unwinding; only the newest pump may touch `running`/`inflight`.
let activePump: object | null = null;
export const setAnalysisAssetLookup = (fn: (id: ID) => MediaAsset | undefined) => {
  assetLookup = fn;
};

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  entries: {},
  queue: [],
  running: false,

  enqueue: (assets) => {
    const { entries, queue } = get();
    const fresh = assets.filter((a) => {
      const e = entries[a.id];
      return !e || e.status === "failed";
    });
    if (fresh.length === 0) return;
    set({
      entries: {
        ...entries,
        ...Object.fromEntries(
          fresh.map((a) => [a.id, { status: "pending" as const, progress: 0 }]),
        ),
      },
      queue: [...queue, ...fresh.map((a) => a.id)],
    });
    void pump(set, get);
  },

  get: (assetId) => get().entries[assetId],
  reset: () => {
    inflight?.abort();
    set({ entries: {}, queue: [], running: false });
  },
}));

type Set = (fn: (s: AnalysisState) => Partial<AnalysisState>) => void;
type Get = () => AnalysisState;

const patchEntry = (set: Set, id: ID, patch: Partial<AnalysisEntry>) =>
  set((s) => ({
    entries: { ...s.entries, [id]: { ...(s.entries[id] ?? { status: "pending", progress: 0 }), ...patch } as AnalysisEntry },
  }));

const pump = async (set: Set, get: Get): Promise<void> => {
  if (get().running) return;
  const me = {};
  activePump = me;
  set(() => ({ running: true }));
  try {
    for (;;) {
      const { queue } = get();
      const next = queue[0];
      if (next === undefined) break;
      set((s) => ({ queue: s.queue.slice(1) }));
      const asset = assetLookup?.(next);
      if (!asset) {
        patchEntry(set, next, { status: "failed", error: "asset missing" });
        continue;
      }
      patchEntry(set, next, { status: "running", progress: 0 });
      const controller = new AbortController();
      inflight = controller;
      try {
        const result = await analyzeAsset(
          asset,
          (p) => {
            if (!controller.signal.aborted) patchEntry(set, next, { progress: p });
          },
          controller.signal,
        );
        // A reset cleared the entries; don't resurrect this one.
        if (controller.signal.aborted || activePump !== me) break;
        if (result) patchEntry(set, next, { status: "done", progress: 1, result });
        else patchEntry(set, next, { status: "failed", error: "analysis returned null" });
      } catch (err) {
        if (controller.signal.aborted || activePump !== me) break;
        patchEntry(set, next, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    if (activePump === me) {
      inflight = null;
      activePump = null;
      set(() => ({ running: false }));
    }
  }
};

// Convenience for the wizard: all finished analyses keyed by asset.
export const doneAnalyses = (entries: Record<ID, AnalysisEntry>): Map<ID, AssetAnalysis> => {
  const out = new Map<ID, AssetAnalysis>();
  for (const [id, e] of Object.entries(entries)) {
    if (e.status === "done" && e.result) out.set(id as ID, e.result);
  }
  return out;
};
