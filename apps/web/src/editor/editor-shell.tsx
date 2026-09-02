"use client";

import { ErrorBoundary } from "@/components/error-boundary";
import { useIsBelow } from "@/hooks/use-breakpoint";
import { useGlobalFileDrop } from "@/hooks/use-global-file-drop";
import { useIsDesktopApp } from "@/hooks/use-is-desktop-app";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { MediaBin } from "@/media/components/media-bin";
import { collectMediaGarbage } from "@/persistence/media-gc";
import { useLocalPersistence } from "@/persistence/use-local-persistence";
import { PreviewViewport } from "@/preview/preview-viewport";
import { TransportBar } from "@/preview/transport-bar";
import { useAudioPlayback } from "@/preview/use-audio-playback";
import { useAutoAnalysis } from "@/autoedit/use-auto-analysis";
import { useProjectStore } from "@/stores/project-store";
import { TimelinePanel } from "@/timeline/components/timeline-panel";
import { FolderOpen, Sliders, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandPalette } from "./command-palette";
import { InspectorPanel } from "./inspector-panel";
import { RightPanel } from "./right-panel";
import { ShortcutCheatsheet } from "./shortcut-cheatsheet";
import { TopBar } from "./top-bar";

export function EditorShell() {
  useKeyboardShortcuts();
  useGlobalFileDrop();
  const persistenceReady = useLocalPersistence();
  useAudioPlayback();
  useAutoAnalysis();
  const isMobile = useIsBelow(900);
  const isDesktopApp = useIsDesktopApp();

  // Reclaim OPFS blobs no project references, shortly after load so the active
  // project has settled. Undo-safe: deletion keeps blobs, GC only reaps ones
  // unreachable from any saved or current project.
  useEffect(() => {
    if (!persistenceReady) return;
    const id = setTimeout(() => {
      void collectMediaGarbage(useProjectStore.getState().project).catch(() => {});
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

  if (isMobile) return <MobileShell />;
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
        <TopBar />
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
              <RightPanel />
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

function MobileShell() {
  const [drawer, setDrawer] = useState<"media" | "inspector" | null>(null);
  return (
    <div className="flex h-full flex-col bg-panel-0 text-ink-1">
      <CommandPalette />
      <ShortcutCheatsheet />
      <header className="h-12 border-b border-line bg-panel-1">
        <TopBar />
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
        >
          <FolderOpen className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setDrawer("inspector")}
          className="btn-ghost flex-1 justify-center"
        >
          <Sliders className="size-5" />
        </button>
      </nav>

      {drawer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-panel-0">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
            <span className="text-sm font-medium text-ink-1">
              {drawer === "media" ? "Media" : "Inspector"}
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
            {drawer === "media" ? <MediaBin /> : <InspectorPanel />}
          </div>
        </div>
      )}
    </div>
  );
}
