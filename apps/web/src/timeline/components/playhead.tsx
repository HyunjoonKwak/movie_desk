"use client";

import { useEditorStore as useProjectStore, selectPlayhead, selectZoom } from "@/stores/editor-store";
import { TRACK_HEADER_W } from "../constants";

export function Playhead({ containerWidth }: { containerWidth: number }) {
  const playhead = useProjectStore(selectPlayhead);
  const zoom = useProjectStore(selectZoom);
  const x = TRACK_HEADER_W + playhead * zoom;

  if (x > containerWidth) return null;

  return (
    <div
      data-testid="tl-playhead"
      className="pointer-events-none absolute top-0 z-20 h-full w-px bg-accent"
      style={{ left: x }}
      aria-hidden
    >
      <div className="absolute -left-1.5 top-0 size-3 rotate-45 bg-accent" />
    </div>
  );
}
