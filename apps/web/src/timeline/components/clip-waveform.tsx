"use client";

import type { MediaClip } from "@movie-desk/core";
import { useMemo } from "react";
import { waveformPath } from "../waveform-path";

interface Props {
  clip: MediaClip;
  width: number;
  height: number;
  durationMs: number;
  peaks: readonly number[];
  // Share of the clip height the waveform occupies, anchored at the bottom.
  band?: number;
}

// Draws the asset's peak envelope clipped to the clip's trim window. Peaks
// are normalized [0,1] across the whole asset; we slice the visible portion
// using trimIn/trimOut relative to the asset duration.
export function ClipWaveform({ clip, width, height, durationMs, peaks, band }: Props) {
  const points = useMemo(() => {
    const dur = durationMs || 1;
    return waveformPath(peaks, {
      width,
      height,
      ...(band === undefined ? {} : { band }),
      from: clip.trimIn / dur,
      to: clip.trimOut / dur,
    });
  }, [durationMs, peaks, clip.trimIn, clip.trimOut, width, height, band]);

  if (!points) return null;
  return (
    <svg
      data-testid="clip-waveform"
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
