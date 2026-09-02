"use client";

import { Magnet, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useProjectStore, selectZoom } from "@/stores/project-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";
import { ZOOM_STEP, clampZoom } from "../constants";
import { zoomToFit } from "../zoom-to-fit";

const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";

export function TimelineZoom() {
  const zoom = useProjectStore(selectZoom);
  const setZoom = useProjectStore((s) => s.setZoomLevel);
  const snapEnabled = useTimelineUiStore((s) => s.snapEnabled);
  const toggleSnap = useTimelineUiStore((s) => s.toggleSnap);
  const t = useT();

  return (
    <div className="flex items-center gap-1 text-meta text-ink-3">
      <button
        type="button"
        className={cn("btn-ghost px-1.5 py-1", snapEnabled && "text-accent")}
        onClick={toggleSnap}
        aria-label={t("timeline.snap")}
        aria-pressed={snapEnabled}
        title={`${t("timeline.snap")} (N)`}
      >
        <Magnet className="size-3.5" />
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-1"
        onClick={() => setZoom(clampZoom(zoom / ZOOM_STEP))}
        aria-label={t("timeline.zoomOut")}
        aria-keyshortcuts="Meta+Minus"
        title={`${t("timeline.zoomOut")} (${mod}−)`}
      >
        <ZoomOut className="size-3.5" />
      </button>
      <span className="w-14 text-center font-mono">{(zoom * 1000).toFixed(1)} px/s</span>
      <button
        type="button"
        className="btn-ghost px-1.5 py-1"
        onClick={() => setZoom(clampZoom(zoom * ZOOM_STEP))}
        aria-label={t("timeline.zoomIn")}
        aria-keyshortcuts="Meta+Equal"
        title={`${t("timeline.zoomIn")} (${mod}=)`}
      >
        <ZoomIn className="size-3.5" />
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-1"
        onClick={zoomToFit}
        aria-label={t("timeline.zoomFit")}
        title={`${t("timeline.zoomFit")} (⇧Z)`}
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
}
