"use client";

import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import type { Project } from "@movie-desk/core";
import { useEffect } from "react";
import { type AudioEngine, createAudioEngine } from "./audio-engine";
import { sourceProjectFor } from "./source-project";

let engine: AudioEngine | null = null;
const sourceEngine = (): AudioEngine => {
  if (!engine) engine = createAudioEngine();
  return engine;
};

const viewedSource = (): Project | null => {
  const { assetId } = useSourceViewerStore.getState();
  const project = useProjectStore.getState().project;
  const asset = assetId ? project.mediaLibrary.find((a) => a.id === assetId) : undefined;
  return asset ? sourceProjectFor(asset, project) : null;
};

// Runs the source viewer's transport: audio through its own engine, the
// picture clock on rAF, and the rules for handing the viewer back to the
// timeline. Mounted once with the editor shell.
export function useSourceViewer(): void {
  useEffect(() => {
    const source = useSourceViewerStore;
    const start = () => {
      const project = viewedSource();
      const { playheadMs, rate } = source.getState();
      if (!project) {
        source.getState().setPlaying(false);
        return;
      }
      void sourceEngine()
        .play(project, playheadMs, rate)
        .catch(() => sourceEngine().stop());
    };

    // Picture: advance on a wall clock while playing. `position` keeps the
    // fractional milliseconds the store rounds away; a scrub resyncs it.
    let raf = 0;
    let last = 0;
    let position = 0;
    const tick = (now: number) => {
      const state = source.getState();
      if (!state.playing) {
        raf = 0;
        return;
      }
      const dt = Math.max(0, now - last);
      last = now;
      if (Math.round(position) !== state.playheadMs) position = state.playheadMs;
      const duration = viewedSource()?.timeline.duration ?? 0;
      position += dt * state.rate;
      if (state.rate < 0 && position <= 0) {
        state.setPlayhead(0);
        state.setPlaying(false);
      } else if (duration > 0 && position >= duration) {
        state.setPlayhead(duration);
        state.setPlaying(false);
      } else {
        state.setPlayhead(position);
      }
      raf = requestAnimationFrame(tick);
    };

    // Audio follows the transport synchronously, inside the user gesture that
    // started it, which is what AudioContext.resume() needs.
    const offTransport = source.subscribe((state, previous) => {
      if (!state.playing) {
        if (previous.playing) sourceEngine().stop();
        return;
      }
      if (!previous.playing) {
        position = state.playheadMs;
        last = performance.now();
        if (!raf) raf = requestAnimationFrame(tick);
        start();
      } else if (state.rate !== previous.rate || state.assetId !== previous.assetId) {
        start();
      } else if (
        state.playheadMs !== previous.playheadMs &&
        state.rate > 0 &&
        sourceEngine().isTransportDrifted(state.playheadMs, state.rate)
      ) {
        start();
      }
    });

    // Browsing ends when the user goes back to the timeline: plays it, moves
    // its playhead, or removes the asset being viewed. A playhead that moved
    // together with an edit (placing a clip) does not count.
    const offTimelinePlay = usePlaybackStore.subscribe((state, previous) => {
      if (state.playing && !previous.playing) source.getState().close();
    });
    const offPlayhead = useProjectStore.subscribe(
      (state) => [state.project.timeline.playhead, state.project.timeline.tracks] as const,
      ([playhead, tracks], [before, tracksBefore]) => {
        if (playhead !== before && tracks === tracksBefore && source.getState().assetId)
          source.getState().close();
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    );
    const offLibrary = useProjectStore.subscribe(
      (state) => state.project.mediaLibrary,
      (library) => {
        const id = source.getState().assetId;
        if (id && !library.some((asset) => asset.id === id)) source.getState().close();
      },
    );

    return () => {
      offTransport();
      offTimelinePlay();
      offPlayhead();
      offLibrary();
      if (raf) cancelAnimationFrame(raf);
      source.getState().close();
      sourceEngine().stop();
    };
  }, []);
}
