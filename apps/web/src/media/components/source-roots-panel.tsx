"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HardDrive, Network, Usb } from "lucide-react";
import { useT } from "@/i18n/use-t";
import {
  assetIdsForRoot,
  readSourceRoots,
  renameSourceRoot,
  rootDisplayName,
  type SourceRoot,
} from "../source-roots";
import { chooseDesktopRelink } from "../desktop-relink";
import { useRelinkRequestStore } from "../relink-request-store";
import { canConsolidate, consolidateRoot, ConsolidateError } from "../consolidate";

const ICONS = {
  local: HardDrive,
  removable: Usb,
  network: Network,
} as const;

const readableSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/**
 * Answers "where are my originals?". Movie Desk references files in place, so
 * without this the locations it depends on are invisible.
 */
export function SourceRootsPanel() {
  const [roots, setRoots] = useState<readonly SourceRoot[] | null>(null);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Focus on open without autoFocus, which steals focus on mount and is
  // disorienting for anyone navigating by keyboard.
  const renameInput = useRef<HTMLInputElement | null>(null);
  const t = useT();
  const gatherable = canConsolidate();

  // Telling someone a drive is missing without offering the fix leaves them to
  // hunt for it. The media bin already owns this flow; this hands it the whole
  // location instead of one card at a time.
  const reconnect = async (root: SourceRoot) => {
    setBusyRoot(root.id);
    try {
      const ids = await assetIdsForRoot(root.id);
      if (!ids.length) return;
      const rows = await chooseDesktopRelink(ids, true);
      if (!rows.length) return;
      useRelinkRequestStore.getState().request(rows);
    } catch (error) {
      toast.error(
        `${t("roots.reconnectFailed")}: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setBusyRoot(null);
    }
  };

  const gather = async (root: SourceRoot) => {
    setBusyRoot(root.id);
    try {
      const outcome = await consolidateRoot(root.id);
      const moved = outcome.moved.length;
      // Always say the originals survived: that is the part a user worries
      // about when a tool starts copying their footage.
      if (outcome.failed.length)
        toast.warning(t("roots.gatherPartial", { count: moved, failed: outcome.failed.length }));
      else if (moved) toast.success(t("roots.gathered", { count: moved }));
      else toast.info(t("roots.gatherNone"));
      setRoots(await readSourceRoots());
    } catch (error) {
      // Cancelling the folder picker is a choice, not a failure to report.
      if (error instanceof ConsolidateError && error.code === "CANCELLED") return;
      toast.error(
        `${t("roots.gatherFailed")}: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setBusyRoot(null);
    }
  };

  useEffect(() => {
    let live = true;
    void readSourceRoots().then((next) => {
      if (live) setRoots(next);
    });
    return () => {
      live = false;
    };
  }, []);

  if (roots === null)
    return (
      <div className="p-3 text-2xs text-ink-3" data-testid="roots-loading">
        {t("roots.loading")}
      </div>
    );

  if (!roots.length)
    return (
      <div className="p-3 text-2xs text-ink-3" data-testid="roots-empty">
        {t("roots.empty")}
      </div>
    );

  return (
    <div className="flex h-full flex-col" data-testid="roots-panel">
      <div className="border-b border-white/5 px-3 py-2 text-2xs text-ink-3">
        {t("roots.summary", { count: roots.length })}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {roots.map((root) => {
          const Icon = ICONS[root.kind];
          return (
            <li
              key={root.id}
              className="rounded border border-white/5 px-2 py-1.5 text-2xs"
              data-testid="roots-row"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-ink-3" />
                {renaming === root.id ? (
                  <input
                    ref={(node) => {
                      renameInput.current = node;
                      node?.focus();
                      node?.select();
                    }}
                    className="min-w-0 flex-1 rounded bg-white/5 px-1 text-ink-1 outline-none"
                    aria-label={t("roots.rename")}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                      if (event.key !== "Enter") return;
                      const next = draftName;
                      setRenaming(null);
                      void renameSourceRoot(root.id, next).then(async (ok) => {
                        if (ok) setRoots(await readSourceRoots());
                      });
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-ink-1"
                    title={t("roots.rename")}
                    onClick={() => {
                      setDraftName(root.displayName ?? rootDisplayName(root));
                      setRenaming(root.id);
                    }}
                  >
                    {rootDisplayName(root)}
                  </button>
                )}
                {root.state === "offline" && (
                  <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-amber-200">
                    {t("roots.offline")}
                  </span>
                )}
              </div>
              {root.state === "offline" && (
                <div className="mt-1 text-amber-200/80">
                  {t("roots.offlineHint", { name: rootDisplayName(root) })}
                  <button
                    type="button"
                    className="mt-1.5 block rounded bg-amber-500/20 px-2 py-1 text-amber-100 disabled:opacity-50"
                    disabled={busyRoot !== null}
                    onClick={() => void reconnect(root)}
                    data-testid="roots-reconnect"
                  >
                    {busyRoot === root.id ? t("roots.reconnecting") : t("roots.reconnect")}
                  </button>
                </div>
              )}
              <div className="mt-1 truncate text-ink-3" title={root.displayPath}>
                {root.displayPath}
              </div>
              <div className="mt-0.5 text-ink-3">
                {t("roots.contents", {
                  count: root.assetCount,
                  size: readableSize(root.totalBytes),
                })}
              </div>
              {gatherable && root.assetCount > 0 && root.state !== "offline" && (
                <button
                  type="button"
                  className="mt-1.5 rounded bg-white/5 px-2 py-1 text-ink-2 disabled:opacity-50"
                  disabled={busyRoot !== null}
                  onClick={() => void gather(root)}
                  data-testid="roots-gather"
                >
                  {busyRoot === root.id ? t("roots.gathering") : t("roots.gather")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/5 px-3 py-2 text-3xs text-ink-3">
        {t("roots.inPlaceNote")}
      </div>
    </div>
  );
}
