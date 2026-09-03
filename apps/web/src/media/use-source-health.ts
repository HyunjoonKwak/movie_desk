"use client";

import type { MediaAsset } from "@movie-desk/core";
import { useEffect, useMemo } from "react";
import { type SourceHealth, isSourceMissing } from "./source/probe-source";
import { useSourceHealthStore } from "./source-health-store";

// Keeps the library's source health current: probes new or changed assets
// when the list changes, and re-probes everything when the window comes
// back into focus (that is when a drive was plugged in or pulled). The
// store throttles forced passes, so a burst of focus events costs one.

export const useSourceHealth = (
  assets: readonly MediaAsset[],
): Readonly<Record<string, SourceHealth>> => {
  const entries = useSourceHealthStore((s) => s.entries);
  const check = useSourceHealthStore((s) => s.check);

  useEffect(() => {
    void check(assets);
  }, [assets, check]);

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      void check(assets, { force: true });
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [assets, check]);

  // Only the missing subset, rebuilt when a probe result or the list changes.
  return useMemo(() => {
    const health: Record<string, SourceHealth> = {};
    for (const asset of assets) {
      const entry = entries[asset.id];
      if (entry && isSourceMissing(entry.health)) health[asset.id] = entry.health;
    }
    return health;
  }, [assets, entries]);
};
