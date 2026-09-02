"use client";

import { useMemo } from "react";
import type { MediaClip } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";

interface Props {
  clip: MediaClip;
  width: number;
  height: number;
}

// Draws the asset's peak envelope clipped to the clip's trim window. Peaks
// are normalized [0,1] across the whole asset; we slice the visible portion
// using trimIn/trimOut relative to the asset duration.
export function ClipWaveform({ clip, width, height }: Props) {
  const asset = useProjectStore((s) =>
    s.project.mediaLibrary.find((a) => a.id === clip.assetId),
  );

  const points = useMemo(() => {
    const peaks = asset?.waveformPeaks;
    if (!peaks || peaks.length === 0 || !asset) return null;
    const dur = asset.durationMs || 1;
    const startFrac = Math.max(0, Math.min(1, clip.trimIn / dur));
    const endFrac = Math.max(startFrac, Math.min(1, clip.trimOut / dur));
    const from = Math.floor(startFrac * peaks.length);
    const to = Math.max(from + 1, Math.floor(endFrac * peaks.length));
    const slice = peaks.slice(from, to);
    // Build a mirrored polyline path centered vertically.
    const n = slice.length;
    const mid = height / 2;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * width;
      const amp = (slice[i]! * height) / 2;
      top.push(`${x.toFixed(1)},${(mid - amp).toFixed(1)}`);
      bottom.push(`${x.toFixed(1)},${(mid + amp).toFixed(1)}`);
    }
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  }, [asset, clip.trimIn, clip.trimOut, width, height]);

  if (!points) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0"
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={points} fill="rgba(255,255,255,0.28)" />
    </svg>
  );
}
