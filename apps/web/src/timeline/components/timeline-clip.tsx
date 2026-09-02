"use client";

import { useMemo, useRef } from "react";
import type { Clip } from "@movie-desk/core";
import { isMediaClip, isAdjustmentClip } from "@movie-desk/core";
import { useProjectStore, selectZoom } from "@/stores/project-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { cn } from "@/lib/cn";
import { ClipContextMenu } from "./clip-context-menu";
import { ClipWaveform } from "./clip-waveform";

interface Props {
  clip: Clip;
  trackHeight: number;
  trackLocked: boolean;
}

type DragMode = "move" | "trim-start" | "trim-end" | null;

interface DragState {
  mode: DragMode;
  startX: number;
  originalStart: number;
  originalDuration: number;
}

export function TimelineClip({ clip, trackHeight, trackLocked }: Props) {
  const zoom = useProjectStore(selectZoom);
  const trimEnd = useProjectStore((s) => s.trimEnd);
  const trimStart = useProjectStore((s) => s.trimStart);
  const moveToTrack = useProjectStore((s) => s.moveClipToOtherTrack);
  const select = useSelectionStore((s) => s.select);
  const isSelected = useSelectionStore((s) => s.clipIds.has(clip.id));

  const media = useProjectStore((s) => s.project.mediaLibrary);
  const asset = useMemo(() => {
    if (!isMediaClip(clip)) return null;
    return media.find((a) => a.id === clip.assetId) ?? null;
  }, [clip, media]);

  const dragRef = useRef<DragState>({
    mode: null,
    startX: 0,
    originalStart: 0,
    originalDuration: 0,
  });

  const onPointerDown =
    (mode: NonNullable<DragMode>) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      select(clip.id, e.shiftKey);
      if (trackLocked) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
      };
      // Move drags run as a session: transient magnetic updates, one undo
      // entry committed on pointer-up.
      if (mode === "move") useProjectStore.getState().beginClipDrag();
    };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.mode) return;
    // Auto-scroll the timeline when dragging near its edges so a clip can
    // travel beyond the visible viewport in a single gesture.
    const scroller = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-tl-scroll]");
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const margin = 48;
      if (e.clientX > rect.right - margin) scroller.scrollLeft += 16;
      else if (e.clientX < rect.left + margin) scroller.scrollLeft -= 16;
    }
    const deltaPx = e.clientX - drag.startX;
    const deltaMs = deltaPx / zoom;
    if (drag.mode === "move") {
      // Absolute target from the drag origin; dragClipTo snaps to nearby
      // edges / markers / playhead, pushes downstream clips magnetically and
      // moves the whole group when grouped — all from the drag-start layout.
      useProjectStore.getState().dragClipTo(clip.id, drag.originalStart + deltaMs);
    } else if (drag.mode === "trim-end") {
      trimEnd(clip.id, Math.max(drag.originalStart + drag.originalDuration + deltaMs, drag.originalStart + 50));
    } else {
      const newStart = Math.min(
        Math.max(0, drag.originalStart + deltaMs),
        drag.originalStart + drag.originalDuration - 50,
      );
      trimStart(clip.id, newStart);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Drop the snap guide once the gesture ends.
    useTimelineUiStore.getState().setSnapMs(null);
    // Commit the whole move gesture as a single undo entry.
    if (dragRef.current.mode === "move") useProjectStore.getState().endClipDrag();
    // If the user dragged the body vertically onto a different track, move it.
    if (dragRef.current.mode === "move") {
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const trackEl = overEl?.closest<HTMLElement>("[data-track]");
      const destTrackId = trackEl?.dataset.track;
      const destKind = trackEl?.dataset.trackKind;
      const isMediaClipNow = isMediaClip(clip);
      const compatible =
        !destKind ||
        (isMediaClipNow && (destKind === "video" || destKind === "audio")) ||
        (!isMediaClipNow && destKind === "text") ||
        destKind === "overlay";
      if (destTrackId && compatible) {
        moveToTrack(clip.id, destTrackId as Parameters<typeof moveToTrack>[1]);
      }
    }
    dragRef.current = { mode: null, startX: 0, originalStart: 0, originalDuration: 0 };
  };

  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const isMedia = isMediaClip(clip);
  const isAdjustment = isAdjustmentClip(clip);
  const showWaveform = isMediaClip(clip) && !!asset?.waveformPeaks && width > 20;

  // Filmstrip: map the clip's trimmed source range across its timeline width.
  // Falls back to the single repeated thumbnail when no strip is available.
  const filmstrip = useMemo(() => {
    if (!isMediaClip(clip) || width <= 40 || !asset?.filmstripDataUrl) return null;
    const dur = asset.durationMs || 1;
    const span = Math.max(1, clip.trimOut - clip.trimIn);
    const visibleFraction = Math.min(1, span / dur);
    const bgFullWidth = width / Math.max(0.0001, visibleFraction);
    const offsetX = (clip.trimIn / dur) * bgFullWidth;
    return {
      backgroundImage: `url(${asset.filmstripDataUrl})`,
      backgroundSize: `${bgFullWidth}px 100%`,
      backgroundPosition: `-${offsetX}px center`,
      backgroundRepeat: "no-repeat",
    } as const;
  }, [clip, asset, width]);
  const showThumb = !filmstrip && isMedia && asset?.thumbDataUrl && width > 40;

  return (
    <ClipContextMenu clipId={clip.id}>
    <div
      data-clip={clip.id}
      className={cn(
        "absolute top-1 select-none overflow-hidden rounded-md border text-xs",
        "transition-shadow",
        isMedia
          ? "border-clip-media/40 bg-clip-media/20 hover:bg-clip-media/30"
          : isAdjustment
            ? "border-clip-adjustment/40 bg-clip-adjustment/20 hover:bg-clip-adjustment/30"
            : "border-clip-overlay/40 bg-clip-overlay/20 hover:bg-clip-overlay/30",
        isSelected && "ring-2 ring-accent shadow-lg",
        clip.disabled && "opacity-40 grayscale",
        clip.groupId && "outline-dashed outline-1 outline-sky-300/50",
      )}
      style={{ left, width, height: trackHeight - 8 }}
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {filmstrip && (
        <div className="pointer-events-none absolute inset-0 opacity-70" style={filmstrip} />
      )}
      {showThumb && (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: `url(${asset!.thumbDataUrl})`,
            backgroundSize: "auto 100%",
            backgroundRepeat: "repeat-x",
          }}
        />
      )}
      {showWaveform && isMediaClip(clip) && (
        <ClipWaveform clip={clip} width={width} height={trackHeight - 8} />
      )}
      <div className="pointer-events-none relative flex h-full items-center px-2">
        <span className="truncate text-ink-1">{clip.label ?? asset?.name ?? clip.kind}</span>
      </div>
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30"
        onPointerDown={onPointerDown("trim-start")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30"
        onPointerDown={onPointerDown("trim-end")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
    </ClipContextMenu>
  );
}
