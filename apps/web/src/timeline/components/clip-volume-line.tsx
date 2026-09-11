"use client";

import { usePrecisionGesture } from "@/components/use-precision-gesture";
import { useT } from "@/i18n/use-t";
import { sampleVolumeCurve } from "@/preview/volume-curve";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { useSelectionStore } from "@/stores/selection-store";
import type { MediaClip } from "@movie-desk/core";
import { useMemo, useRef, useState } from "react";
import { formatGain, gainAtY, yForGain } from "../clip-volume";

// The horizontal gain line across an audio-bearing clip: drag it up or down
// to set the clip volume (one undo per drag), double-click for 100 %. A
// clip with volume keyframes shows its curve instead; the inspector edits it.
// The line sits at mid-height at 100 %, where a plain click selects the
// clip — so a press here selects too and the band stays thin.
const HIT_PX = 6;
const INSET_PX = 6;

interface Props {
  readonly clip: MediaClip;
  readonly width: number;
  readonly height: number;
  readonly locked?: boolean;
}

export function ClipVolumeLine({ clip, width, height, locked = false }: Props) {
  const t = useT();
  const setVolume = useProjectStore((s) => s.setClipVolume);
  const gain = clip.volume ?? 1;
  const gesture = usePrecisionGesture((value) => setVolume(clip.id, value), "Clip volume", gain);
  const [live, setLive] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startGain: number } | null>(null);
  const track = clip.keyframes.find((k) => k.target === "volume");
  const keyed = !!track?.keyframes.length;

  const curve = useMemo(() => {
    if (!keyed || !track) return null;
    const n = Math.max(2, Math.floor(width / 4));
    const samples = sampleVolumeCurve(track, gain, 0, clip.duration, n);
    return Array.from(
      samples,
      (v, i) => `${((i / (n - 1)) * width).toFixed(1)},${yForGain(v, height).toFixed(1)}`,
    ).join(" ");
  }, [keyed, track, gain, width, height, clip.duration]);

  if (curve) {
    return (
      <svg
        className="pointer-events-none absolute inset-0"
        width={width}
        height={height}
        aria-hidden="true"
        data-testid="clip-volume-curve"
      >
        <title>{t("timeline.volumeKeyed")}</title>
        <polyline
          points={curve}
          fill="none"
          stroke="rgba(252, 211, 77, 0.9)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      </svg>
    );
  }

  const shown = live ?? gain;
  const y = yForGain(shown, height);
  return (
    <div
      data-testid="clip-volume-line"
      data-volume={shown.toFixed(2)}
      className="absolute cursor-ns-resize"
      style={{ left: INSET_PX, right: INSET_PX, top: y - HIT_PX / 2, height: HIT_PX }}
      title={`${formatGain(shown)} · ${t("timeline.volumeHint")}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        useSelectionStore.getState().select(clip.id, e.shiftKey);
        if (locked) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startY: e.clientY, startGain: gain };
        setLive(gain);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        e.stopPropagation();
        const next = gainAtY(yForGain(drag.startGain, height) + (e.clientY - drag.startY), height);
        const value = Math.round(next * 100) / 100;
        setLive(value);
        gesture.preview(value);
      }}
      onPointerUp={(e) => {
        if (!dragRef.current) return;
        e.stopPropagation();
        dragRef.current = null;
        setLive(null);
        gesture.finish();
      }}
      onPointerCancel={(e) => {
        if (!dragRef.current) return;
        e.stopPropagation();
        dragRef.current = null;
        setLive(null);
        gesture.finish(true);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setVolume(clip.id, 1);
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-amber-300/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
      {live !== null && (
        <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1 font-mono text-3xs text-white">
          {formatGain(live)}
        </span>
      )}
    </div>
  );
}
