"use client";

import { useEffect, useRef, useState } from "react";
import { formatTimecode } from "@movie-desk/core";
import { useProjectStore, selectZoom } from "@/stores/project-store";
import { TRACK_HEADER_W } from "../constants";

// FCP-style skimmer: hovering the timeline (no buttons pressed) shows a
// translucent time cursor + timecode readout without moving the playhead.
// Listeners attach to the surrounding [data-tl-inner] element so only this
// tiny component re-renders per pointer move.
export function SkimLine() {
  const [ms, setMs] = useState<number | null>(null);
  const zoom = useProjectStore(selectZoom);
  const fps = useProjectStore((s) => s.project.framerate);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = anchorRef.current?.closest<HTMLElement>("[data-tl-inner]");
    if (!inner) return;
    const onMove = (e: PointerEvent) => {
      // Active drags (seek, clip move/trim) hide the skimmer.
      if (e.buttons !== 0) {
        setMs(null);
        return;
      }
      const rect = inner.getBoundingClientRect();
      const x = e.clientX - rect.left - TRACK_HEADER_W;
      setMs(x >= 0 ? x / useProjectStore.getState().project.timeline.zoom : null);
    };
    const onLeave = () => setMs(null);
    inner.addEventListener("pointermove", onMove);
    inner.addEventListener("pointerleave", onLeave);
    inner.addEventListener("pointerdown", onLeave);
    return () => {
      inner.removeEventListener("pointermove", onMove);
      inner.removeEventListener("pointerleave", onLeave);
      inner.removeEventListener("pointerdown", onLeave);
    };
  }, []);

  return (
    <div ref={anchorRef} className="contents">
      {ms !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-px bg-ink-3/60"
          style={{ left: TRACK_HEADER_W + ms * zoom }}
          aria-hidden
        >
          <span className="absolute left-1 top-0 rounded bg-panel-3 px-1 py-0.5 font-mono text-3xs text-ink-2 shadow">
            {formatTimecode(ms, fps)}
          </span>
        </div>
      )}
    </div>
  );
}
