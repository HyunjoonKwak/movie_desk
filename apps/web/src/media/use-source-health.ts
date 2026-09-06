"use client";

import type { MediaAsset } from "@movie-desk/core";
import { useEffect, useMemo, useRef } from "react";
import { FIRST_PASS_DELAY_MS, useSourceHealthStore } from "./source-health-store";
import { readDesktopMediaBridge, parseDesktopSourceStateReport } from "./source/desktop-media-bridge";
import { type SourceHealth, isSourceMissing } from "./source/probe-source";

// Keeps the library's source health current: probes new or changed assets
// when the list changes, and re-probes everything when the window comes
// back into focus (that is when a drive was plugged in or pulled). The
// store throttles forced passes, so a burst of focus events costs one.

export const useSourceHealth = (
  assets: readonly MediaAsset[],
): Readonly<Record<string, SourceHealth>> => {
  const entries = useSourceHealthStore((s) => s.entries);
  const check = useSourceHealthStore((s) => s.check);

  const latest = useRef(assets);
  latest.current = assets;
  const started = useRef(false);

  useEffect(() => {
    let disposed = false;
    const disk = assets.filter((asset) => asset.sourceRef?.kind === "disk" && !useSourceHealthStore.getState().entries[asset.id]);
    const bridge = readDesktopMediaBridge();
    if (bridge?.lastSourceStates) {
      for (let offset = 0; offset < disk.length; offset += 1000) {
        const batch = disk.slice(offset, offset + 1000);
        void bridge.lastSourceStates(batch.map((asset) => asset.id)).then((value) => {
          if (disposed || typeof value !== "object" || value === null) return;
          useSourceHealthStore.setState((state) => {
            const entries = { ...state.entries };
            for (const asset of batch) {
              if (entries[asset.id]) continue;
              try {
                const { state: saved } = parseDesktopSourceStateReport({ state: (value as Record<string, unknown>)[asset.id] });
                entries[asset.id] = { asset, health: saved === "online" ? "ok" : saved, checkedAt: Number.NEGATIVE_INFINITY };
              } catch { /* Unknown saved states never suppress a fresh probe. */ }
            }
            return { entries };
          });
        }).catch(() => {});
      }
    }
    return () => { disposed = true; };
  }, [assets]);

  useEffect(() => {
    // Let restoration and visible previews finish before opening every original.
    // Preview/export preflight still checks a requested source immediately.
    const timer = setTimeout(() => {
      started.current = true;
      void check(latest.current, { prune: true });
    }, FIRST_PASS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [check]);

  useEffect(() => {
    if (started.current) void check(assets, { prune: true });
  }, [assets, check]);

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      void check(latest.current, { force: true, prune: true });
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const disk = latest.current.filter((asset) => asset.sourceRef?.kind === "disk");
      if (disk.length) void check(disk, { force: true });
    }, 30_000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [check]);

  // Only the missing subset. The same object is returned while that subset
  // is unchanged, so a probe pass over a thousand healthy assets does not
  // re-render the whole media bin on every flush.
  const previous = useRef<MissingMap>({});
  return useMemo(() => {
    const next = selectMissing(entries, assets, previous.current);
    previous.current = next;
    return next;
  }, [assets, entries]);
};

export type MissingMap = Readonly<Record<string, SourceHealth>>;

// The missing subset of `assets`; returns `previous` itself when nothing
// in that subset changed (same ids, same states).
export const selectMissing = (
  entries: Readonly<Record<string, { readonly health: SourceHealth }>>,
  assets: readonly MediaAsset[],
  previous: MissingMap,
): MissingMap => {
  const health: Record<string, SourceHealth> = {};
  for (const asset of assets) {
    const entry = entries[asset.id];
    if (entry && isSourceMissing(entry.health)) health[asset.id] = entry.health;
  }
  const keys = Object.keys(health);
  const same =
    keys.length === Object.keys(previous).length && keys.every((id) => previous[id] === health[id]);
  return same ? previous : health;
};
