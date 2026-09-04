"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Cloud, Download, Film, Loader2, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { useSaveStateStore } from "@/persistence/save-state-store";
import { saveSnapshot } from "@/persistence/snapshots";
import { ExportDialog } from "@/export/export-dialog";
import { ProjectMenu } from "./project-menu";
import { SnapshotMenu } from "./snapshot-menu";
import { useT } from "@/i18n/use-t";
import { LanguageToggle } from "@/i18n/language-toggle";
import { useAppVersion } from "@/hooks/use-app-version";
import type { ID } from "@movie-desk/core";

export function TopBar({ onNewProject }: { onNewProject?: (projectId: ID) => void }) {
  const projectName = useProjectStore((s) => s.project.name);
  const renameProject = useProjectStore((s) => s.renameProject);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.history.past.length > 0);
  const canRedo = useProjectStore((s) => s.history.future.length > 0);
  const saveState = useSaveStateStore((s) => s.state);
  const lastSavedAt = useSaveStateStore((s) => s.lastSavedAt);
  const [exportOpen, setExportOpen] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const committedOnEnterRef = useRef(false);
  useEffect(() => {
    // A project switch can finish while the user is already typing. Keep the
    // in-progress edit intact and sync external names once the field is idle.
    if (document.activeElement !== nameInputRef.current) setDraftName(projectName);
  }, [projectName]);
  const t = useT();
  const appVersion = useAppVersion();

  // Surface the active project in the window / tab title. Next.js can apply
  // streamed route metadata AFTER hydration, clobbering a one-shot assignment
  // — so watch the <title> node and re-assert ours until unmount.
  useEffect(() => {
    const desired = `${projectName} — Movie Desk`;
    document.title = desired;
    const el = document.querySelector("title");
    if (!el) return;
    const observer = new MutationObserver(() => {
      // Guard prevents self-triggering: once equal, the callback no-ops.
      if (document.title !== desired) document.title = desired;
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [projectName]);

  // Desktop (Electron) native menu bridge: the preload script re-dispatches
  // File-menu IPC as window events — wire them to the matching UI actions.
  useEffect(() => {
    const onMenuExport = () => setExportOpen(true);
    const onMenuSnapshot = () => {
      void saveSnapshot(useProjectStore.getState().project, "").then(() =>
        toast.success(t("snap.saved")),
      );
    };
    window.addEventListener("movie-desk:menu-export", onMenuExport);
    window.addEventListener("movie-desk:menu-snapshot", onMenuSnapshot);
    return () => {
      window.removeEventListener("movie-desk:menu-export", onMenuExport);
      window.removeEventListener("movie-desk:menu-snapshot", onMenuSnapshot);
    };
  }, [t]);

  return (
    <div className="flex h-full items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2 text-ink-1"
          title="Movie Desk"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-panel-2 text-accent ring-1 ring-inset ring-line-strong transition-colors group-hover:bg-panel-3">
            <Film className="size-3.5" />
          </span>
          <span className="hidden text-meta font-semibold tracking-wide xl:inline">Movie Desk</span>
        </Link>
        <div className="hidden h-4 w-px bg-line xl:block" />
        <input
          ref={nameInputRef}
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={(e) => {
            if (committedOnEnterRef.current) {
              committedOnEnterRef.current = false;
              return;
            }
            // Read from the DOM event instead of the render-time draft. A
            // paste/fill immediately followed by Enter can blur before React
            // has committed the latest onChange state.
            const name = e.currentTarget.value;
            if (name !== projectName) renameProject(name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Commit before blur so keyboard submission does not depend on
              // React flushing the controlled input's latest value first.
              const name = e.currentTarget.value;
              committedOnEnterRef.current = true;
              if (name !== projectName) renameProject(name);
              e.currentTarget.blur();
            }
            if (e.key === "Escape") setDraftName(projectName);
          }}
          aria-label={t("project.rename")}
          className="min-w-0 w-24 rounded-md border border-transparent bg-transparent px-2 py-1 text-[13.5px] font-medium text-ink-1 outline-none transition-colors hover:border-line hover:bg-panel-2 focus:border-line-strong focus:bg-panel-2 sm:w-36 lg:w-44"
        />
        {appVersion && (
          <span className="hidden font-mono text-3xs text-ink-3 2xl:inline">v{appVersion}</span>
        )}
        <span className="hidden md:inline-flex">
          <SaveBadge state={saveState} lastSavedAt={lastSavedAt} />
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="toolbar-cluster hidden lg:flex">
          <button
            type="button"
            className="btn-ghost min-h-7 px-2 py-1"
            onClick={undo}
            disabled={!canUndo}
            aria-label={t("topbar.undo")}
            title={t("topbar.undo")}
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="btn-ghost min-h-7 px-2 py-1"
            onClick={redo}
            disabled={!canRedo}
            aria-label={t("topbar.redo")}
            title={t("topbar.redo")}
          >
            <Redo2 className="size-3.5" />
          </button>
        </div>
        <div className="toolbar-cluster">
          <ProjectMenu {...(onNewProject ? { onNewProject } : {})} />
          <span className="hidden xl:block">
            <SnapshotMenu />
          </span>
        </div>
        <span className="hidden lg:block">
          <LanguageToggle />
        </span>
        <button
          type="button"
          className="btn-primary min-h-8 px-3"
          onClick={() => setExportOpen(true)}
        >
          <Download className="size-4" />
          {t("topbar.export")}
        </button>
      </div>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}

function SaveBadge({ state, lastSavedAt }: { state: string; lastSavedAt: number | null }) {
  const t = useT();
  const label =
    state === "saving"
      ? t("topbar.saving")
      : state === "saved" && lastSavedAt
        ? `${t("topbar.saved")} • ${timeAgo(lastSavedAt, t)}`
        : t("topbar.localFirst");
  const Icon = state === "saving" ? Loader2 : state === "saved" ? Check : Cloud;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-ok/25 bg-ok/[0.06] px-2 py-1 text-3xs text-ok"
      title={state}
    >
      <Icon className={state === "saving" ? "size-3 animate-spin" : "size-3"} />
      {label}
    </span>
  );
}

const timeAgo = (ts: number, t: ReturnType<typeof useT>): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return t("topbar.justNow");
  if (s < 60) return t("topbar.secondsAgo", { n: s });
  const m = Math.floor(s / 60);
  return t("topbar.minutesAgo", { n: m });
};
