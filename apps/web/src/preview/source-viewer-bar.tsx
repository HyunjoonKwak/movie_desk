"use client";

import { useT } from "@/i18n/use-t";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import { type MediaAsset, formatTimecode } from "@movie-desk/core";
import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { markIn, markOut } from "./source-range";

// Transport strip under the viewer while it shows a source: where the
// playhead is in the file, the use range marked with I/O, and the way onto
// the timeline. The range is the asset's own, so the card and every
// placement see the same marks.
export function SourceViewerBar({ asset }: { asset: MediaAsset }) {
  const t = useT();
  const playhead = useSourceViewerStore((s) => s.playheadMs);
  const close = useSourceViewerStore((s) => s.close);
  const fps = useProjectStore((s) => s.project.framerate);
  const setAssetUseRange = useProjectStore((s) => s.setAssetUseRange);
  const placeAsset = useProjectStore((s) => s.placeAsset);
  const trackRef = useRef<HTMLDivElement>(null);

  const duration = Math.max(1, asset.durationMs);
  const inMs = asset.useInMs ?? 0;
  const outMs = asset.useOutMs ?? duration;
  const hasRange = asset.useInMs !== undefined || asset.useOutMs !== undefined;
  const pct = (ms: number): string => `${(Math.min(duration, Math.max(0, ms)) / duration) * 100}%`;

  const scrubTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const source = useSourceViewerStore.getState();
    source.setPlaying(false);
    source.setPlayhead(fraction * duration);
  };

  return (
    <div
      data-testid="source-viewer"
      className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-2xs"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-200">
          {t("source.viewing")}
        </span>
        <span className="truncate text-ink-1" data-testid="source-viewer-name">
          {asset.name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-ink-2">
          {formatTimecode(playhead, fps)} / {formatTimecode(duration, fps)}
        </span>
        <button
          type="button"
          onClick={close}
          className="rounded p-0.5 text-ink-3 hover:text-ink-1"
          title={t("source.close")}
          aria-label={t("source.close")}
          data-testid="source-close"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t("source.scrub")}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
        data-testid="source-scrub"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) scrubTo(e.clientX);
        }}
        className="relative mt-2 h-6 cursor-crosshair touch-none select-none overflow-hidden rounded bg-black/60"
      >
        <div
          className="absolute inset-y-0 bg-amber-400/25"
          style={{ left: pct(inMs), width: pct(outMs - inMs) }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-amber-300" style={{ left: pct(inMs) }} />
        <div className="absolute inset-y-0 w-0.5 bg-amber-300" style={{ left: pct(outMs) }} />
        <div
          className="absolute inset-y-0 w-px bg-white"
          style={{ left: pct(playhead) }}
          data-testid="source-playhead"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAssetUseRange(asset.id, markIn(asset, playhead))}
          data-testid="source-mark-in"
        >
          {t("source.markIn")}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAssetUseRange(asset.id, markOut(asset, playhead))}
          data-testid="source-mark-out"
        >
          {t("source.markOut")}
        </button>
        <span className="font-mono text-amber-200" data-testid="source-range">
          {formatTimecode(inMs, fps)} – {formatTimecode(outMs, fps)}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAssetUseRange(asset.id, undefined)}
          disabled={!hasRange}
          data-testid="source-range-clear"
        >
          {t("media.rangeClear")}
        </button>
        <span className="hidden text-ink-3 md:inline">{t("source.rangeHint")}</span>
        <button
          type="button"
          className="btn-primary ml-auto"
          onClick={() => placeAsset(asset, "append")}
          data-testid="source-add"
        >
          <Plus className="size-3.5" />
          {t("source.add")}
        </button>
      </div>
    </div>
  );
}
