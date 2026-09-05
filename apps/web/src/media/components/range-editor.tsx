"use client";

import { useEffect, useRef, useState } from "react";
import { Scissors, X } from "lucide-react";
import { useAssetFilmstrip } from "@/stores/preview-store";
import { useProjectStore } from "@/stores/project-store";
import { useT } from "@/i18n/use-t";
import { fmtSec } from "@/media/format";
import type { MediaAsset } from "@movie-desk/core";

export function RangeEditor({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const t = useT();
  const setAssetUseRange = useProjectStore((s) => s.setAssetUseRange);
  const strip = useAssetFilmstrip(asset);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ anchorMs: number } | null>(null);
  const [inMs, setInMs] = useState(asset.useInMs ?? 0);
  const [outMs, setOutMs] = useState(asset.useOutMs ?? asset.durationMs);

  // 카드 배지에서 다른 자산으로 전환하면 로컬 상태 재초기화
  useEffect(() => {
    setInMs(asset.useInMs ?? 0);
    setOutMs(asset.useOutMs ?? asset.durationMs);
  }, [asset.useInMs, asset.useOutMs, asset.durationMs]);

  const msAt = (clientX: number): number => {
    const el = stripRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(f * asset.durationMs);
  };

  const commit = (a: number, b: number) => {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(asset.durationMs, Math.max(a, b));
    if (lo <= 0 && hi >= asset.durationMs) {
      setAssetUseRange(asset.id, undefined); // 전체 구간 = 지정 해제
    } else if (hi - lo >= 200) {
      setAssetUseRange(asset.id, { inMs: lo, outMs: hi });
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const ms = msAt(e.clientX);
    dragging.current = { anchorMs: ms };
    setInMs(ms);
    setOutMs(ms);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const ms = msAt(e.clientX);
    const { anchorMs } = dragging.current;
    setInMs(Math.min(anchorMs, ms));
    setOutMs(Math.max(anchorMs, ms));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const ms = msAt(e.clientX);
    const { anchorMs } = dragging.current;
    dragging.current = null;
    commit(Math.min(anchorMs, ms), Math.max(anchorMs, ms));
  };

  const leftPct = (Math.min(inMs, outMs) / Math.max(1, asset.durationMs)) * 100;
  const rightPct = 100 - (Math.max(inMs, outMs) / Math.max(1, asset.durationMs)) * 100;

  return (
    <div className="border-t border-white/10 bg-panel-2 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs">
        <Scissors className="size-3 text-amber-300" />
        <span className="truncate font-medium text-ink-1">{asset.name}</span>
        <span className="ml-auto font-mono text-ink-3">
          {fmtSec(inMs)} – {fmtSec(outMs)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-ink-3 hover:text-ink-1"
          title={t("media.close")}
        >
          <X className="size-3" />
        </button>
      </div>

      <div
        ref={stripRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="relative h-12 cursor-crosshair touch-none select-none overflow-hidden rounded bg-black"
      >
        {strip ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={strip.dataUrl}
            alt=""
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        ) : asset.waveformPeaks && asset.waveformPeaks.length > 0 ? (
          <div className="pointer-events-none flex size-full items-center gap-px px-0.5">
            {asset.waveformPeaks.slice(0, 160).map((p, i) => (
              <div
                // 파형 막대는 정적 스냅샷 — 순서가 바뀌지 않으므로 인덱스 키가 안전
                // biome-ignore lint/suspicious/noArrayIndexKey: static waveform bars never reorder
                key={i}
                className="flex-1 rounded-sm bg-accent/60"
                style={{ height: `${Math.max(6, p * 100)}%` }}
              />
            ))}
          </div>
        ) : (
          <div className="pointer-events-none size-full bg-gradient-to-r from-accent/20 to-accent/40" />
        )}
        {/* 구간 밖 마스크 + 경계 핸들 */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/70"
          style={{ width: `${leftPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/70"
          style={{ width: `${rightPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-300"
          style={{ left: `${leftPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-300"
          style={{ right: `${rightPct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-3xs text-ink-3">
        <span>{t("media.rangeHint")}</span>
        <button
          type="button"
          onClick={() => {
            setInMs(0);
            setOutMs(asset.durationMs);
            setAssetUseRange(asset.id, undefined);
          }}
          className="ml-auto whitespace-nowrap rounded border border-white/15 px-1.5 py-0.5 text-ink-1 hover:border-white/40"
        >
          {t("media.rangeClear")}
        </button>
      </div>
    </div>
  );
}
