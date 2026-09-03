"use client";

import type { MediaAsset } from "@movie-desk/core";
import { useEffect } from "react";
import { type SourceHealth, isSourceMissing } from "./source/probe-source";
import { useSourceHealthStore } from "./source-health-store";

// Keeps the library's source health current: probes new or changed assets
// when the list changes, and re-probes everything when the window comes
// back into focus (that is when a drive was plugged in or pulled).

// Focus can fire in bursts (dialogs, tab switches); one re-probe per burst.
const REFOCUS_THROTTLE_MS = 1_000;

export const useSourceHealth = (
  assets: readonly MediaAsset[],
): Readonly<Record<string, SourceHealth>> => {
  const entries = useSourceHealthStore((s) => s.entries);
  const check = useSourceHealthStore((s) => s.check);

  useEffect(() => {
    void check(assets);
  }, [assets, check]);

  useEffect(() => {
    let lastRecheck = 0;
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRecheck < REFOCUS_THROTTLE_MS) return;
      lastRecheck = now;
      void check(assets, { force: true });
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [assets, check]);

  const health: Record<string, SourceHealth> = {};
  for (const asset of assets) {
    const entry = entries[asset.id];
    if (entry && isSourceMissing(entry.health)) health[asset.id] = entry.health;
  }
  return health;
};
