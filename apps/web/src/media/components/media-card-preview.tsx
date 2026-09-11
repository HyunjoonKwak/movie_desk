"use client";

import { useT } from "@/i18n/use-t";
import { fmtSec } from "@/media/format";
import { MIN_RANGE_MS } from "@/preview/source-range";
import { useAssetFilmstrip } from "@/stores/preview-store";
import { useProjectStore } from "@/stores/project-store";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import type { MediaAsset } from "@movie-desk/core";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// The picture area of a media card. Moving the pointer across it skims:
// the card shows the filmstrip frame under the pointer and the viewer draws
// that time. The thin strip along the bottom edge sets the asset's use
// range by dragging; the rest of the card still drags onto the timeline.
export const RANGE_STRIP_PX = 10;

// dragstart fires on the draggable card, not on the strip under the pointer,
// so the card asks here whether the press began as a range drag.
let rangeDragActive = false;
export const isRangeDragActive = (): boolean => rangeDragActive;

interface Props {
  readonly asset: MediaAsset;
  readonly thumb: string | undefined;
  readonly Icon: LucideIcon;
  readonly previewVisible: boolean;
}

interface DragRange {
  readonly anchorMs: number;
  readonly currentMs: number;
}

export function MediaCardPreview({ asset, thumb, Icon, previewVisible }: Props) {
  const t = useT();
  const [skim, setSkim] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragRange | null>(null);
  const strip = useAssetFilmstrip(
    asset.kind === "video" ? asset : null,
    previewVisible && skim !== null,
  );
  const areaRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const duration = Math.max(1, asset.durationMs);
  const inMs = drag ? Math.min(drag.anchorMs, drag.currentMs) : (asset.useInMs ?? 0);
  const outMs = drag ? Math.max(drag.anchorMs, drag.currentMs) : (asset.useOutMs ?? duration);
  const hasRange = drag !== null || asset.useInMs !== undefined || asset.useOutMs !== undefined;
  const pct = (ms: number): string => `${(Math.min(duration, Math.max(0, ms)) / duration) * 100}%`;

  const fractionAt = (clientX: number): number => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  // The viewer follows at most once per frame; leaving the card releases it.
  const publish = (fraction: number | null) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const source = useSourceViewerStore.getState();
      if (fraction === null) {
        if (source.skimAssetId === asset.id) source.clearSkim();
      } else {
        source.skim(asset.id, fraction * duration);
      }
    });
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      const source = useSourceViewerStore.getState();
      if (source.skimAssetId === asset.id) source.clearSkim();
    },
    [asset.id],
  );

  const frame =
    strip && strip.frames > 0 && skim !== null
      ? (() => {
          const index = Math.min(strip.frames - 1, Math.floor(skim * strip.frames));
          const x = strip.frames > 1 ? (index / (strip.frames - 1)) * 100 : 0;
          return {
            backgroundImage: `url(${strip.dataUrl})`,
            backgroundSize: `${strip.frames * 100}% 100%`,
            backgroundPosition: `${x}% 0`,
          };
        })()
      : null;

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    rangeDragActive = false;
    if (!drag) return;
    e.stopPropagation();
    setDrag(null);
    const lo = Math.round(Math.min(drag.anchorMs, drag.currentMs));
    const hi = Math.round(Math.max(drag.anchorMs, drag.currentMs));
    // The viewer shows the source from the start of what was just chosen; a
    // plain click on the strip only views it there.
    useSourceViewerStore.getState().show(asset.id, lo);
    if (hi - lo < MIN_RANGE_MS) return;
    useProjectStore
      .getState()
      .setAssetUseRange(asset.id, lo <= 0 && hi >= duration ? undefined : { inMs: lo, outMs: hi });
  };

  return (
    <div
      ref={areaRef}
      className="absolute inset-0"
      data-testid="card-preview"
      onPointerMove={(e) => {
        if (drag) return;
        const fraction = fractionAt(e.clientX);
        setSkim(fraction);
        publish(fraction);
      }}
      onPointerLeave={() => {
        setSkim(null);
        publish(null);
      }}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt={asset.name} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-ink-3">
          <Icon className="size-6" />
        </div>
      )}
      {/* Overlaid, never swapped in for the image: replacing the element
          under a pressed pointer would swallow the click that views the source. */}
      {frame && <div className="absolute inset-0" style={frame} data-testid="card-skim-frame" />}
      {hasRange && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/60"
            style={{ width: pct(inMs) }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/60"
            style={{ width: pct(duration - outMs) }}
          />
        </>
      )}
      {skim !== null && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
            style={{ left: `${skim * 100}%` }}
            data-testid="card-skim-line"
          />
          <span className="pointer-events-none absolute bottom-3.5 left-1/2 -translate-x-1/2 rounded bg-black/70 px-1 font-mono text-3xs text-white">
            {fmtSec(skim * duration)}
          </span>
        </>
      )}
      <div
        aria-hidden="true"
        title={t("media.rangeStrip")}
        data-testid="card-range-strip"
        data-range-strip
        className="absolute inset-x-0 bottom-0 cursor-col-resize touch-none bg-black/50"
        style={{ height: RANGE_STRIP_PX }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          rangeDragActive = true;
          const ms = fractionAt(e.clientX) * duration;
          setDrag({ anchorMs: ms, currentMs: ms });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          e.stopPropagation();
          setDrag({ ...drag, currentMs: fractionAt(e.clientX) * duration });
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute inset-y-0 bg-amber-400/80"
          style={{ left: pct(inMs), width: pct(outMs - inMs) }}
        />
      </div>
    </div>
  );
}
