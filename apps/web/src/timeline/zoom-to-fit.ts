"use client";

import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { TRACK_HEADER_W, clampZoom } from "./constants";

// Fit the whole timeline into the visible scroll viewport (FCP Shift+Z).
export const zoomToFit = (): void => {
  const el = document.querySelector<HTMLElement>("[data-tl-scroll]");
  const store = useProjectStore.getState();
  const duration = store.project.timeline.duration;
  if (!el || duration <= 0) return;
  const available = Math.max(100, el.clientWidth - TRACK_HEADER_W - 24);
  store.setZoomLevel(clampZoom(available / duration));
  el.scrollLeft = 0;
};
