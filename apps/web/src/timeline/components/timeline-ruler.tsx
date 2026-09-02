"use client";

import { useMemo } from "react";
import { formatTimecode } from "@movie-desk/core";
import { useProjectStore, selectZoom } from "@/stores/project-store";

interface Tick {
  ms: number;
  label: string | null;
}

const niceStepMs = (zoom: number): { step: number; major: number } => {
  // pixels per ms → choose tick step so labels are ~80px apart
  const targetPx = 80;
  const idealMs = targetPx / zoom;
  const candidates = [50, 100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000];
  const step = candidates.find((c) => c >= idealMs) ?? candidates.at(-1)!;
  const major = step;
  return { step: step / 5, major };
};

export function TimelineRuler({ width }: { width: number }) {
  const zoom = useProjectStore(selectZoom);
  const fps = useProjectStore((s) => s.project.framerate);

  const ticks = useMemo<Tick[]>(() => {
    const totalMs = width / zoom;
    const { step, major } = niceStepMs(zoom);
    const out: Tick[] = [];
    for (let ms = 0; ms <= totalMs; ms += step) {
      out.push({
        ms,
        label: ms % major === 0 ? formatTimecode(ms, fps) : null,
      });
    }
    return out;
  }, [width, zoom, fps]);

  return (
    <div className="sticky top-0 z-10 h-7 border-b border-white/10 bg-panel-1">
      <svg className="block size-full" preserveAspectRatio="none" aria-hidden="true">
        {ticks.map((t) => {
          const x = t.ms * zoom;
          const isMajor = t.label !== null;
          return (
            <g key={t.ms}>
              <line
                x1={x}
                x2={x}
                y1={isMajor ? 12 : 18}
                y2={28}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
              />
              {t.label && (
                <text
                  x={x + 3}
                  y={11}
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                  fill="rgba(155,165,180,0.9)"
                >
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
