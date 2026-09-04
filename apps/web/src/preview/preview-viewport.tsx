"use client";

import { Compositor } from "@/renderer/compositor";
import { usePlaybackStore } from "@/stores/playback-store";
import { selectPlayhead, useProjectStore } from "@/stores/project-store";
import type { ID } from "@movie-desk/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Clapperboard } from "lucide-react";
// Side-effect import: registers `window.__cutBench(frames)` in dev for
// console-driven render benchmarks.
import "@/renderer/bench";
import { useT } from "@/i18n/use-t";
import { GuidesOverlay } from "./guides-overlay";
import { MissingMediaNotice } from "./missing-media-notice";
import { PreviewControls } from "./preview-controls";
import { RegionOverlay } from "./region-overlay";

// Phase 3 preview: WebGL2 compositor. Visible clips at the playhead are
// stacked and drawn into a single canvas, replacing the phase-1 single
// <video> element. Frame-accurate WebCodecs decode comes in phase 3.1.

export function PreviewViewport() {
  const project = useProjectStore((s) => s.project);
  const playhead = useProjectStore(selectPlayhead);
  const playing = usePlaybackStore((s) => s.playing);
  const setPlayhead = useProjectStore((s) => s.setPlayheadMs);
  const t = useT();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const disposePendingRef = useRef<Compositor | null>(null);
  const renderingRef = useRef(false);
  const redrawPendingRef = useRef(false);

  const assetById = useMemo(() => {
    const map = new Map(project.mediaLibrary.map((a) => [a.id, a]));
    return (id: ID) => map.get(id);
  }, [project.mediaLibrary]);
  const assetByIdRef = useRef(assetById);
  assetByIdRef.current = assetById;

  // One render pump shared by paused redraws and playback. If state changes
  // while WebGL/video seeking is still in flight, coalesce it into one latest
  // redraw instead of starting a second render against the same compositor.
  const drawLatest = useCallback(function pump(): void {
    const compositor = compositorRef.current;
    if (!compositor) return;
    if (renderingRef.current) {
      redrawPendingRef.current = true;
      return;
    }
    renderingRef.current = true;
    redrawPendingRef.current = false;
    void compositor
      .renderFrame(useProjectStore.getState().project, assetByIdRef.current)
      .catch(() => {
        // The preview error boundary/logging path handles persistent failures.
      })
      .finally(() => {
        renderingRef.current = false;
        const pending = disposePendingRef.current;
        if (pending) {
          disposePendingRef.current = null;
          pending.dispose();
        }
        if (redrawPendingRef.current) queueMicrotask(pump);
      });
  }, []);

  // Lazily create the compositor once the canvas mounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!compositorRef.current) {
      try {
        compositorRef.current = new Compositor(canvas);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: Preserve initialization details for GPU diagnostics.
        console.error("Failed to init WebGL compositor", err);
        return;
      }
    }
    const compositor = compositorRef.current;
    compositor.setPlayheadGetter(() => useProjectStore.getState().project.timeline.playhead);

    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      compositor.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      if (compositorRef.current !== compositor) return;
      compositorRef.current = null;
      redrawPendingRef.current = false;
      // renderFrame can await media decode/seek work. Defer disposal until the
      // in-flight frame settles so it cannot resume against released GL state.
      if (renderingRef.current) disposePendingRef.current = compositor;
      else compositor.dispose();
    };
  }, []);

  // A single wall-clock loop owns playback. It deliberately does not depend on
  // `project`/`playhead`: those change every tick and used to recreate the loop,
  // reset its in-flight guard, and allow overlapping video seeks.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let cancelled = false;
    let last = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      // The first rAF timestamp is the frame's start time, which can PRECEDE
      // the performance.now() captured above — an unclamped negative dt at
      // playhead 0 made `next <= 0` and stopped playback the instant it began.
      const dt = Math.max(0, now - last);
      last = now;
      const rate = usePlaybackStore.getState().rate;
      const timeline = useProjectStore.getState().project.timeline;
      const next = timeline.playhead + dt * rate;
      if (rate < 0 && next <= 0) {
        setPlayhead(0);
        usePlaybackStore.getState().setPlaying(false);
      } else if (timeline.duration > 0 && next >= timeline.duration) {
        setPlayhead(timeline.duration);
        usePlaybackStore.getState().setPlaying(false);
      } else {
        setPlayhead(next);
      }
      drawLatest();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [playing, setPlayhead, drawLatest]);

  // Editing and scrubbing while paused still redraw immediately; while playing
  // the scheduler above owns presentation and this effect stays passive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally trigger paused redraws; drawLatest reads current state from refs/stores.
  useEffect(() => {
    if (!playing) drawLatest();
  }, [playing, playhead, project, assetById, drawLatest]);

  const { w, h } = project.resolution;

  return (
    <div className="relative flex h-full w-full items-center justify-center p-4">
      <PreviewControls />
      <div
        className="relative max-h-full max-w-full overflow-hidden rounded-md border border-line bg-black shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        <canvas ref={canvasRef} data-preview-canvas className="size-full" />
        <RegionOverlay />
        <GuidesOverlay />
        <MissingMediaNotice />
        {project.mediaLibrary.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(96,93,255,0.08),transparent_55%)] px-8 text-center">
            <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line-strong bg-panel-2 text-accent">
              <Clapperboard className="size-5" />
            </span>
            <p className="text-sm font-medium text-ink-1">{t("preview.empty")}</p>
            <p className="mt-2 max-w-sm text-2xs leading-5 text-ink-3">{t("preview.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
