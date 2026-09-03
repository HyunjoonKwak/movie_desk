"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { clipIdsInMarquee, type ID } from "@movie-desk/core";
import { useProjectStore, selectZoom } from "@/stores/project-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useRangeStore } from "@/stores/range-store";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { useT } from "@/i18n/use-t";
import { TimelineRuler } from "./timeline-ruler";
import { TimelineTrack } from "./timeline-track";
import { Playhead } from "./playhead";
import { TimelineZoom } from "./timeline-zoom";
import { MarkerStrip } from "./marker-strip";
import { RangeBand } from "./range-band";
import { SnapGuide } from "./snap-guide";
import { SkimLine } from "./skim-line";
import { TRACK_HEADER_W, clampZoom } from "../constants";

export function TimelinePanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tracks = useProjectStore((s) => s.project.timeline.tracks);
  const duration = useProjectStore((s) => s.project.timeline.duration);
  const zoom = useProjectStore(selectZoom);
  const setZoom = useProjectStore((s) => s.setZoomLevel);
  const setPlayhead = useProjectStore((s) => s.setPlayheadMs);
  const addNewTrack = useProjectStore((s) => s.addNewTrack);
  const hasRange = useRangeStore((s) => s.inMs !== null || s.outMs !== null);
  const t = useT();

  // Zoom keeping the timeline instant under the anchor x (viewport px from
  // the container's left edge) stationary — FCP-style pointer-centric zoom.
  const zoomAround = useCallback(
    (factor: number, anchorX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const cur = useProjectStore.getState().project.timeline.zoom;
      const next = clampZoom(cur * factor);
      if (next === cur) return;
      const ms = (el.scrollLeft + anchorX - TRACK_HEADER_W) / cur;
      setZoom(next);
      // Apply after React lays out the wider/narrower content, otherwise the
      // scroll position clamps against the stale scrollWidth.
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, ms * next - anchorX + TRACK_HEADER_W);
      });
    },
    [setZoom],
  );

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      zoomAround(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left);
    }
  };

  // Two-finger pinch zoom for touch / trackpad gestures — anchored to the
  // viewport centre.
  usePinchZoom(containerRef, {
    onZoom: (factor) => {
      const el = containerRef.current;
      zoomAround(factor, el ? el.clientWidth / 2 : 0);
    },
    onPan: (dx) => {
      const el = containerRef.current;
      if (el) el.scrollLeft -= dx;
    },
  });

  const minWidth = Math.max(1200, duration * zoom + 800);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const inner = containerRef.current?.querySelector<HTMLDivElement>("[data-tl-inner]");
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const x = clientX - rect.left - TRACK_HEADER_W;
      setPlayhead(Math.max(0, x / zoom));
    },
    [setPlayhead, zoom],
  );

  // Marquee (rubber-band) selection — Cmd/Ctrl+drag over the background.
  // Coordinates are relative to the [data-tl-inner] element.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );

  // Press bookkeeping shared by the scrub and marquee gestures. `moved` tells a
  // click apart from a drag: the background doubles as the scrub surface, so
  // "clear the selection on release" has to fire for a click and stay out of
  // the way of a scrub.
  const pressRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    onTrack: boolean;
    cancelled: boolean;
  } | null>(null);

  // Below this the press is a click, not a drag — matches the media bin.
  const DRAG_SLOP = 4;

  const innerPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const press = pressRef.current;
    pressRef.current = null;
    return press;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Only act when the press landed on the ruler / background, not a clip.
    const target = e.target as HTMLElement;
    if (target.closest("[data-clip]")) return;
    // Track-header controls (mute, solo, lock…) sit inside the background and
    // must not scrub or deselect on their way to their own onClick.
    if (target.closest("button, input, select, textarea")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      // Only presses inside a track row clear the selection. Clicking the
      // ruler is how you reposition the playhead; losing the selection to it
      // would punish an ordinary seek.
      onTrack: !!target.closest("[data-track]"),
      cancelled: false,
    };
    if (e.metaKey || e.ctrlKey) {
      const p = innerPoint(e);
      setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    seekFromPointer(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.buttons & 1) === 0) return;
    const press = pressRef.current;
    if (press?.cancelled) return;
    if (press && !press.moved) {
      press.moved =
        Math.abs(e.clientX - press.x) > DRAG_SLOP || Math.abs(e.clientY - press.y) > DRAG_SLOP;
    }
    if (marquee) {
      const p = innerPoint(e);
      setMarquee({ ...marquee, x1: p.x, y1: p.y });
      return;
    }
    seekFromPointer(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const inner = e.currentTarget;
    const press = endPress(e);
    const band = marquee;
    setMarquee(null);
    if (press?.cancelled) return;

    // A press that never moved is a click: on empty track space that means
    // "deselect". Esc does the same thing globally.
    if (!press?.moved) {
      if (press?.onTrack) useSelectionStore.getState().clear();
      return;
    }
    if (!band) return;

    const innerRect = inner.getBoundingClientRect();
    const [left, right] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)];
    const [top, bottom] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)];

    // Tracks whose row intersects the marquee vertically. The id round-trips
    // through the DOM as a plain string, so it needs re-branding here.
    const hitTrackIds = new Set<ID>();
    for (const row of inner.querySelectorAll<HTMLElement>("[data-track]")) {
      const r = row.getBoundingClientRect();
      const rowTop = r.top - innerRect.top;
      const rowBottom = rowTop + r.height;
      if (rowBottom >= top && rowTop <= bottom && row.dataset.track) {
        hitTrackIds.add(row.dataset.track as ID);
      }
    }

    const tracksNow = useProjectStore.getState().project.timeline.tracks;
    const ids = clipIdsInMarquee(
      tracksNow,
      hitTrackIds,
      (left - TRACK_HEADER_W) / zoom,
      (right - TRACK_HEADER_W) / zoom,
    );
    useSelectionStore.getState().selectMany(ids);
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    endPress(e);
    setMarquee(null);
  };

  // Esc abandons an in-flight band. The press stays flagged as cancelled so the
  // rest of the drag neither scrubs nor re-opens the marquee on release.
  const marqueeActive = marquee !== null;
  useEffect(() => {
    if (!marqueeActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pressRef.current) pressRef.current.cancelled = true;
      setMarquee(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marqueeActive]);

  return (
    <div className="flex h-full flex-col bg-panel-1">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line bg-panel-1 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 shrink-0 text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">
            {t("timeline.title")}
          </span>
          <div className="mr-1 h-4 w-px shrink-0 bg-line" />
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() => addNewTrack("video")}
            title={t("timeline.addVideoTrack")}
          >
            <Plus className="size-3" /> V
          </button>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() => addNewTrack("audio")}
            title={t("timeline.addAudioTrack")}
          >
            <Plus className="size-3" /> A
          </button>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() => useProjectStore.getState().addTextClipAtPlayhead("Title")}
            title={t("timeline.addTextClip")}
          >
            <Plus className="size-3" /> T
          </button>
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none px-1.5 py-0.5 text-2xs">
              <Plus className="size-3" /> {t("timeline.shape")}
            </summary>
            <div className="absolute left-0 z-30 mt-1 w-32 rounded-md border border-white/10 bg-panel-3 p-1 shadow-lg">
              {(["rect", "ellipse", "line"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => useProjectStore.getState().addShapeClipAtPlayhead(s)}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-ink-1 hover:bg-white/10"
                >
                  {t(`shape.${s}`)}
                </button>
              ))}
            </div>
          </details>
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none px-1.5 py-0.5 text-2xs">
              <Plus className="size-3" /> {t("timeline.titleTpl")}
            </summary>
            <div className="absolute left-0 z-30 mt-1 w-44 rounded-md border border-white/10 bg-panel-3 p-1 shadow-lg">
              {([
                "title",
                "subtitle",
                "lowerThird",
                "travelTitle",
                "chapterCard",
                "growthTitle",
              ] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => useProjectStore.getState().addTitleTemplate(k)}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-ink-1 hover:bg-white/10"
                >
                  {t(`titleTpl.${k}`)}
                </button>
              ))}
            </div>
          </details>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() => useProjectStore.getState().addAdjustmentClipAtPlayhead()}
            title={t("timeline.addAdjustment")}
          >
            <Plus className="size-3" /> {t("timeline.adjustment")}
          </button>
          <div className="mx-1 h-4 w-px bg-line" />
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() =>
              useRangeStore.getState().setIn(useProjectStore.getState().project.timeline.playhead)
            }
            title={t("range.setIn")}
          >
            {t("range.in")}
          </button>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() =>
              useRangeStore.getState().setOut(useProjectStore.getState().project.timeline.playhead)
            }
            title={t("range.setOut")}
          >
            {t("range.out")}
          </button>
          {hasRange && (
            <button
              type="button"
              className="btn-ghost px-1.5 py-0.5 text-2xs text-ink-3"
              onClick={() => useRangeStore.getState().clear()}
              title={t("range.clear")}
            >
              {t("range.clear")}
            </button>
          )}
        </div>
        <TimelineZoom />
      </div>

      <div
        ref={containerRef}
        data-tl-scroll
        className="relative flex-1 overflow-auto"
        onWheel={onWheel}
      >
        <div
          data-tl-inner
          className="relative"
          style={{ minWidth }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <TimelineRuler width={minWidth} />
          <MarkerStrip />
          <RangeBand />
          <div className="flex flex-col gap-1 px-0 py-2">
            {tracks.map((track) => (
              <TimelineTrack key={track.id} track={track} width={minWidth} />
            ))}
          </div>
          <Playhead containerWidth={minWidth} />
          <SnapGuide />
          <SkimLine />
          {marquee && (
            <div
              data-testid="tl-marquee"
              className="pointer-events-none absolute z-20 rounded-sm border border-accent/70 bg-accent/15"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
