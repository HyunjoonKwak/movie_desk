"use client";

import { Compositor } from "@/renderer/compositor";
import { captureScopes } from "@/scopes/frames";
import { selectPlayhead, useEditorStore as useProjectStore } from "@/stores/editor-store";
import { usePlaybackStore } from "@/stores/playback-store";
import type { ID } from "@movie-desk/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Side-effect import: registers `window.__cutBench(frames)` in dev for
// console-driven render benchmarks.
import "@/renderer/bench";
import { useT } from "@/i18n/use-t";
import { GuidesOverlay } from "./guides-overlay";
import { needsLinearColorMigrationHint } from "./linear-color-hint";
import { MissingMediaNotice } from "./missing-media-notice";
import { PreviewControls } from "./preview-controls";
import { RegionOverlay } from "./region-overlay";

import { StateHint } from "@/components/state-hint";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { sourceProjectFor } from "./source-project";
import { SourceViewerBar } from "./source-viewer-bar";

// Phase 3 preview: WebGL2 compositor. Visible clips at the playhead are
// stacked and drawn into a single canvas, replacing the phase-1 single
// <video> element. Frame-accurate WebCodecs decode comes in phase 3.1.

export function PreviewViewport() {
  const project = useProjectStore((s) => s.project);
  const playhead = useProjectStore(selectPlayhead);
  const playing = usePlaybackStore((s) => s.playing);
  const setPlayhead = useProjectStore((s) => s.setPlayheadMs);
  const t = useT();
  const shownAssetId = useSourceViewerStore((s) => s.assetId);
  const skimAssetId = useSourceViewerStore((s) => s.skimAssetId);
  const shownAsset = useMemo(
    () => (shownAssetId ? project.mediaLibrary.find((a) => a.id === shownAssetId) : undefined),
    [project.mediaLibrary, shownAssetId],
  );
  const skimAsset = useMemo(
    () => (skimAssetId ? project.mediaLibrary.find((a) => a.id === skimAssetId) : undefined),
    [project.mediaLibrary, skimAssetId],
  );
  // What the canvas is showing: the skimmed card, else the shown source.
  const sourceAsset = skimAsset ?? shownAsset;

  const [migrationProject, setMigrationProject] = useState<string | null>(null);
  const [colorNotice, setColorNotice] = useState<string | null>(null);
  useEffect(() => {
    const warning = (event: Event) => {
      const { code, name } = (event as CustomEvent<{ code: string; name: string }>).detail;
      setColorNotice(t(`color.${code}`, { name }));
    };
    window.addEventListener("color-processing-warning", warning);
    return () => window.removeEventListener("color-processing-warning", warning);
  }, [t]);
  const { createdAt, mediaLibrary, resolution } = project;
  const tracks = project.timeline.tracks;
  useEffect(() => {
    if (!needsLinearColorMigrationHint({ createdAt, tracks, mediaLibrary, resolution })) return;
    const key = `cut.linear-color-notice.${project.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      setMigrationProject(project.id);
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, [project.id, createdAt, tracks, mediaLibrary, resolution]);

  const [contextGeneration, setContextGeneration] = useState(0);
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
    const editor = useProjectStore.getState().project;
    const source = useSourceViewerStore.getState();
    // A card being skimmed wins over the shown source, which wins over the timeline.
    const skimAsset = source.skimAssetId
      ? editor.mediaLibrary.find((asset) => asset.id === source.skimAssetId)
      : undefined;
    const sourceAsset =
      skimAsset ??
      (source.assetId
        ? editor.mediaLibrary.find((asset) => asset.id === source.assetId)
        : undefined);
    // Skimming shows the frame under the cursor without moving the playhead.
    // It is ignored during playback (the transport owns the frame) and on a
    // child tab, where the hover time is child-local but the viewer draws the
    // root; a wrong frame is worse than the cursor line alone.
    const ui = useTimelineUiStore.getState();
    const onRoot = ui.activeTimelineId === null || ui.activeTimelineId === editor.rootTimelineId;
    const skim = !usePlaybackStore.getState().playing && onRoot ? ui.skimMs : null;
    // While a source is shown the viewer draws its one-clip project at the
    // source transport, through the same compositor as the timeline.
    const project = sourceAsset ? sourceProjectFor(sourceAsset, editor) : editor;
    const at = skimAsset ? source.skimMs : sourceAsset ? source.playheadMs : skim;
    const playhead = at ?? project.timeline.playhead;
    canvasRef.current?.setAttribute("data-render-playhead", String(Math.round(playhead)));
    void compositor
      .renderFrame(project, assetByIdRef.current, at === null ? {} : { playhead: at })
      .then(() => {
        if (canvasRef.current) captureScopes(canvasRef.current);
      })
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

  useEffect(() => {
    window.addEventListener("scopes-redraw", drawLatest);
    return () => window.removeEventListener("scopes-redraw", drawLatest);
  }, [drawLatest]);

  useEffect(
    () =>
      useTimelineUiStore.subscribe((state, before) => {
        if (state.skimMs !== before.skimMs) drawLatest();
      }),
    [drawLatest],
  );
  useEffect(
    () =>
      useSourceViewerStore.subscribe((state, before) => {
        if (
          state.playheadMs !== before.playheadMs ||
          state.assetId !== before.assetId ||
          state.skimAssetId !== before.skimAssetId ||
          state.skimMs !== before.skimMs
        )
          drawLatest();
      }),
    [drawLatest],
  );

  // Lazily create the compositor, repeating capability probes after restoration.
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextGeneration intentionally recreates invalidated GPU resources.
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

    const lost = (event: Event) => {
      event.preventDefault();
      compositor.invalidate();
      compositorRef.current = null;
      redrawPendingRef.current = false;
      if (renderingRef.current) disposePendingRef.current = compositor;
      else compositor.dispose();
    };
    const restored = () => setContextGeneration((value) => value + 1);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    const ro = new ResizeObserver(() => {
      if (compositorRef.current !== compositor) return;
      const rect = canvas.getBoundingClientRect();
      compositor.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
    drawLatest();
    return () => {
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (compositorRef.current !== compositor) return;
      compositorRef.current = null;
      redrawPendingRef.current = false;
      // renderFrame can await media decode/seek work. Defer disposal until the
      // in-flight frame settles so it cannot resume against released GL state.
      if (renderingRef.current) disposePendingRef.current = compositor;
      else compositor.dispose();
    };
  }, [contextGeneration, drawLatest]);

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

  const viewed = sourceAsset ? sourceProjectFor(sourceAsset, project) : project;
  const { w, h } = viewed.resolution;

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center gap-2 p-4"
      data-viewer-mode={sourceAsset ? "source" : "timeline"}
    >
      {!sourceAsset && <PreviewControls />}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-md border border-line bg-black shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
          style={{ aspectRatio: `${w} / ${h}` }}
        >
          <canvas ref={canvasRef} data-preview-canvas className="size-full" />
          {!sourceAsset && <RegionOverlay />}
          {!sourceAsset && <GuidesOverlay />}
          {!sourceAsset && <MissingMediaNotice />}
          {(colorNotice || migrationProject === project.id) && (
            <div className="absolute inset-x-0 bottom-0 space-y-2 bg-black/90 p-2">
              {migrationProject === project.id && (
                <StateHint
                  testId="color-migration-hint"
                  tone="info"
                  text={t("color.migration")}
                  dismiss={{ label: t("state.dismiss"), onClick: () => setMigrationProject(null) }}
                />
              )}
              {colorNotice && (
                <StateHint
                  testId="color-processing-hint"
                  tone="warning"
                  text={colorNotice}
                  dismiss={{ label: t("state.dismiss"), onClick: () => setColorNotice(null) }}
                />
              )}
            </div>
          )}
          {!sourceAsset && !project.timeline.tracks.some((track) => track.clips.length > 0) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
              <StateHint testId="preview-empty-hint" text={t("state.preview.empty")} />
            </div>
          )}
        </div>
      </div>
      {shownAsset && <SourceViewerBar asset={shownAsset} />}
      {!shownAsset && skimAsset && (
        <div
          className="w-full truncate rounded-md border border-line bg-panel-2 px-3 py-1.5 text-2xs text-ink-2"
          data-testid="skim-name"
        >
          {skimAsset.name}
        </div>
      )}
    </div>
  );
}
