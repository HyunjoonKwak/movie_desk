"use client";

import { useAutoAnalysis } from "@/autoedit/use-auto-analysis";
import { AutoEditPanel } from "@/autoedit/components/autoedit-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { useIsBelow } from "@/hooks/use-breakpoint";
import { useGlobalFileDrop } from "@/hooks/use-global-file-drop";
import { useIsDesktopApp } from "@/hooks/use-is-desktop-app";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";
import { MediaBin } from "@/media/components/media-bin";
import { collectMediaGarbage } from "@/persistence/media-gc";
import { collectPreviewGarbage } from "@/persistence/previews";
import { useLocalPersistence } from "@/persistence/use-local-persistence";
import { PreviewViewport } from "@/preview/preview-viewport";
import { TransportBar } from "@/preview/transport-bar";
import { useAudioPlayback } from "@/preview/use-audio-playback";
import { useProjectStore } from "@/stores/project-store";
import { TimelinePanel } from "@/timeline/components/timeline-panel";
import { FolderOpen, Sliders, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandPalette } from "./command-palette";
import { InspectorPanel } from "./inspector-panel";
import { NewProjectStart, type NewProjectPath } from "./new-project-start";
import {
  clearNewProjectStartPending,
  isNewProjectStartPending,
  markNewProjectStartPending,
} from "./new-project-start-state";
import { RightPanel, type RightPanelTab } from "./right-panel";
import { ShortcutCheatsheet } from "./shortcut-cheatsheet";
import { TopBar } from "./top-bar";

export function EditorShell() {
  useKeyboardShortcuts();
  const persistenceReady = useLocalPersistence();
  useAudioPlayback();
  useAutoAnalysis();
  const isMobile = useIsBelow(900);
  const isDesktopApp = useIsDesktopApp();
  const projectId = useProjectStore((state) => state.project.id);
  // Hydration replaces this bootstrap project when a saved project exists.
  // Identity lets C1 recognize only the genuinely fresh editor without
  // changing persistence behavior or reopening guidance for saved empties.
  const bootstrapProjectId = useRef(projectId);
  const [requestedStartProjectId, setRequestedStartProjectId] = useState<string | null>(null);
  const [completedStartIds, setCompletedStartIds] = useState<ReadonlySet<string>>(new Set());
  const [entry, setEntry] = useState<{ projectId: string; path: NewProjectPath }>({
    projectId,
    path: "manual",
  });

  const showFreshStart =
    bootstrapProjectId.current === projectId && !completedStartIds.has(projectId);
  const showStart =
    showFreshStart || requestedStartProjectId === projectId || isNewProjectStartPending(projectId);
  const showStartRef = useRef(showStart);
  showStartRef.current = showStart;
  const activePath = entry.projectId === projectId ? entry.path : "manual";
  const onNewProject = useCallback((id: string) => {
    markNewProjectStartPending(id);
    setEntry({ projectId: id, path: "manual" });
    setRequestedStartProjectId(id);
  }, []);
  const onChooseStart = useCallback(
    (path: NewProjectPath) => {
      clearNewProjectStartPending(projectId);
      setEntry({ projectId, path });
      setCompletedStartIds((current) => new Set(current).add(projectId));
      setRequestedStartProjectId(null);
    },
    [projectId],
  );
  const onGlobalImportHandled = useCallback(() => {
    if (showStartRef.current) onChooseStart("organize");
  }, [onChooseStart]);
  useGlobalFileDrop(onGlobalImportHandled);

  // Persist only projects that actually reached the start screen. Existing
  // saved empty projects have no marker, so they continue to open directly in
  // the expert editor while an unanswered new project survives a reload.
  useEffect(() => {
    if (!persistenceReady || !showFreshStart) return;
    markNewProjectStartPending(projectId);
  }, [persistenceReady, projectId, showFreshStart]);

  // Reclaim OPFS blobs no project references, shortly after load so the active
  // project has settled. Undo-safe: deletion keeps blobs, GC only reaps ones
  // unreachable from any saved or current project.
  useEffect(() => {
    if (!persistenceReady) return;
    const id = setTimeout(() => {
      void collectMediaGarbage(() => useProjectStore.getState().project).catch(() => {});
      void collectPreviewGarbage(() => useProjectStore.getState().project).catch(() => {});
    }, 3000);
    return () => clearTimeout(id);
  }, [persistenceReady]);

  if (!persistenceReady) {
    return (
      <div className="flex h-full items-center justify-center bg-panel-0 text-xs text-ink-3">
        Loading project…
      </div>
    );
  }

  if (showStart) {
    return (
      <div className="flex h-full flex-col bg-panel-0 text-ink-1">
        <CommandPalette />
        <ShortcutCheatsheet />
        <header
          className={cn(
            "h-12 shrink-0 border-b border-line bg-panel-1",
            isDesktopApp && "app-region-drag pl-[72px]",
          )}
        >
          <TopBar onNewProject={onNewProject} />
        </header>
        <NewProjectStart key={projectId} onChoose={onChooseStart} />
      </div>
    );
  }

  if (isMobile) {
    return (
      <MobileShell
        onNewProject={onNewProject}
        initialDrawer={activePath === "guided" ? "auto" : null}
      />
    );
  }
  const initialRightTab: RightPanelTab = activePath === "guided" ? "auto" : "inspector";
  return (
    <div className="flex h-full flex-col bg-panel-0 text-ink-1">
      <CommandPalette />
      <ShortcutCheatsheet />
      <header
        className={cn(
          "h-12 shrink-0 border-b border-line bg-panel-1",
          // Electron hiddenInset window: leave room for the traffic lights
          // and let the bar double as the draggable title bar.
          isDesktopApp && "app-region-drag pl-[72px]",
        )}
      >
        <TopBar onNewProject={onNewProject} />
      </header>
      {/* Resizable workspace, FCP-style: browser | viewer | inspector on
          top, timeline below. Split ratios persist via autoSaveId. */}
      <PanelGroup direction="vertical" autoSaveId="movie-desk:layout-rows" className="flex-1">
        <Panel defaultSize={62} minSize={30}>
          <PanelGroup direction="horizontal" autoSaveId="movie-desk:layout-cols">
            <Panel
              defaultSize={18}
              minSize={12}
              collapsible
              collapsedSize={0}
              className="overflow-hidden border-r border-line bg-panel-1"
            >
              <MediaBin />
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel minSize={30}>
              <main className="flex h-full flex-col overflow-hidden bg-panel-0">
                <div className="min-h-0 flex-1">
                  <ErrorBoundary label="Preview">
                    <PreviewViewport />
                  </ErrorBoundary>
                </div>
                {/* Transport controls live with the viewer, FCP-style. */}
                <div className="h-11 shrink-0 border-t border-line bg-panel-1">
                  <TransportBar />
                </div>
              </main>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel
              defaultSize={20}
              minSize={14}
              collapsible
              collapsedSize={0}
              className="overflow-hidden border-l border-line bg-panel-1"
            >
              <RightPanel initialTab={initialRightTab} />
            </Panel>
          </PanelGroup>
        </Panel>
        <ResizeHandle orientation="horizontal" />
        <Panel defaultSize={38} minSize={15} className="overflow-hidden border-t border-line">
          <TimelinePanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}

// Slim divider that widens its hit area on hover and highlights while
// dragging. `orientation` refers to the divider line itself.
function ResizeHandle({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return (
    <PanelResizeHandle
      className={cn(
        "bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent/70",
        orientation === "vertical" ? "w-1" : "h-1",
      )}
    />
  );
}

type MobileDrawer = "media" | "auto" | "inspector";

function MobileShell({
  onNewProject,
  initialDrawer,
}: {
  onNewProject: (projectId: string) => void;
  initialDrawer: MobileDrawer | null;
}) {
  const [drawer, setDrawer] = useState<MobileDrawer | null>(initialDrawer);
  const t = useT();
  return (
    <div className="flex h-full flex-col bg-panel-0 text-ink-1">
      <CommandPalette />
      <ShortcutCheatsheet />
      <header className="h-12 border-b border-line bg-panel-1">
        <TopBar onNewProject={onNewProject} />
      </header>
      <main className="flex-1 overflow-hidden bg-panel-0">
        <ErrorBoundary label="Preview">
          <PreviewViewport />
        </ErrorBoundary>
      </main>
      <section className="h-11 border-t border-line bg-panel-1">
        <TransportBar />
      </section>
      <section className="h-56 overflow-hidden border-t border-line">
        <TimelinePanel />
      </section>
      <nav className="flex h-12 items-center justify-around border-t border-line bg-panel-1">
        <button
          type="button"
          onClick={() => setDrawer("media")}
          className="btn-ghost flex-1 justify-center"
          aria-label={t("media.title")}
          title={t("media.title")}
        >
          <FolderOpen className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setDrawer("auto")}
          className="btn-ghost flex-1 justify-center"
          aria-label={t("auto.tab")}
          title={t("auto.tab")}
        >
          <Wand2 className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setDrawer("inspector")}
          className="btn-ghost flex-1 justify-center"
          aria-label={t("inspector.title")}
          title={t("inspector.title")}
        >
          <Sliders className="size-5" />
        </button>
      </nav>

      {drawer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-panel-0">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
            <span className="text-sm font-medium text-ink-1">
              {drawer === "media"
                ? t("media.title")
                : drawer === "auto"
                  ? t("auto.tab")
                  : t("inspector.title")}
            </span>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {drawer === "media" ? (
              <MediaBin />
            ) : drawer === "auto" ? (
              <AutoEditPanel />
            ) : (
              <InspectorPanel />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
