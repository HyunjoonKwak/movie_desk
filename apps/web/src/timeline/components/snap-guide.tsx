"use client";

import { useEditorStore as useProjectStore, selectZoom } from "@/stores/editor-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { TRACK_HEADER_W } from "../constants";

// Vertical guide line shown while a dragged clip is magnetised to a snap
// point (clip edge / marker / playhead). Cleared on pointer-up.
export function SnapGuide() {
  const snapMs = useTimelineUiStore((s) => s.snapMs);
  const zoom = useProjectStore(selectZoom);
  if (snapMs === null) return null;

  return (
    <div
      className="pointer-events-none absolute top-0 z-20 h-full w-px bg-amber-300/90"
      style={{ left: TRACK_HEADER_W + snapMs * zoom }}
      aria-hidden
    />
  );
}
