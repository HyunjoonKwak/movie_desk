"use client";

import { useEditorStore as useProjectStore, selectZoom } from "@/stores/editor-store";
import { useRangeStore } from "@/stores/range-store";

// Visualizes the export work area (in/out points) as a tinted band over the
// timeline. Aligned to clip content via the left-24 (96px) header offset,
// matching the marker strip.
export function RangeBand() {
  const zoom = useProjectStore(selectZoom);
  const duration = useProjectStore((s) => s.project.timeline.duration);
  const inMs = useRangeStore((s) => s.inMs);
  const outMs = useRangeStore((s) => s.outMs);

  if (inMs === null && outMs === null) return null;
  const from = inMs ?? 0;
  const to = outMs ?? duration;

  return (
    <div className="pointer-events-none absolute bottom-0 left-24 right-0 top-7 z-[5]">
      <div
        className="absolute top-0 h-full border-x border-emerald-400/60 bg-emerald-400/10"
        style={{ left: from * zoom, width: Math.max(0, (to - from) * zoom) }}
      />
    </div>
  );
}
