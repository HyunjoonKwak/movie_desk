"use client";

import { formatTimecode } from "@movie-desk/core";
import { useEditorStore as useProjectStore, selectZoom } from "@/stores/editor-store";

// Marker pins drawn beneath the ruler. Click a pin to jump there; alt-click
// (or the context menu) to remove it.
export function MarkerStrip() {
  const fps = useProjectStore((s) => s.project.framerate);
  const markers = useProjectStore((s) => s.project.timeline.markers) ?? [];
  const zoom = useProjectStore(selectZoom);
  const setPlayhead = useProjectStore((s) => s.setPlayheadMs);
  const removeMarker = useProjectStore((s) => s.removeMarkerById);

  if (markers.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-24 right-0 top-7 z-10 h-3">
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (e.altKey) removeMarker(m.id);
            else setPlayhead(m.at);
          }}
          title={m.label || formatTimecode(m.at, fps)}
          className="pointer-events-auto absolute h-3 w-2 -translate-x-1 rounded-sm"
          style={{ left: m.at * zoom, backgroundColor: m.color }}
        />
      ))}
    </div>
  );
}
