"use client";

import { disposePitchWorkers, pitchPlaybackKey } from "@/audio/pitch-renderer";
import { usePlaybackStore } from "@/stores/playback-store";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import type { Project } from "@movie-desk/core";
import { useEffect } from "react";
import { getAudioEngine } from "./audio-engine";

// Nested renders bake child controls into PCM; child edits must invalidate it.
const playbackKey = (project: Project): string =>
  JSON.stringify([
    pitchPlaybackKey(project.timeline.tracks),
    project.timeline.tracks.flatMap((track) =>
      track.clips.filter((clip) => clip.kind === "sequence"),
    ),
    project.timelines
      .filter((timeline) => timeline.id !== project.timeline.id)
      .map((timeline) => [timeline.id, timeline.duration, timeline.tracks]),
    project.timeline.tracks.some((track) => track.clips.some((clip) => clip.kind === "sequence"))
      ? project.audio?.buses
      : undefined,
  ]);

// Bridges the playback store to the audio engine: start monitoring from the
// current playhead when play begins (or the rate changes), stop on pause.
// Playhead advances are intentionally NOT a dependency — the engine schedules
// once from the start position and the AudioContext clock carries it, in step
// with the rAF picture loop in PreviewViewport.
export function useAudioPlayback(): void {
  useEffect(() => {
    const engine = getAudioEngine();
    let scheduledKey = playbackKey(useProjectStore.getState().project);
    const start = () => {
      const playback = usePlaybackStore.getState();
      const project = useProjectStore.getState().project;
      scheduledKey = playbackKey(project);
      void engine.play(project, project.timeline.playhead, playback.rate).catch(() => {
        // Autoplay policy or decode failure: stay silent without leaving a
        // half-scheduled transport behind.
        engine.stop();
      });
    };

    // A vanilla Zustand subscription runs synchronously inside the click/key
    // handler that toggles playback. That gives AudioContext.resume() the user
    // activation browsers require, unlike starting it later from a React effect.
    const offPlayback = usePlaybackStore.subscribe((state, previous) => {
      if (!state.playing) {
        engine.stop();
      } else if (!previous.playing || state.rate !== previous.rate) {
        start();
      }
    });
    const offPlayhead = useProjectStore.subscribe(
      (state) => state.project.timeline.playhead,
      (playhead) => {
        const playback = usePlaybackStore.getState();
        if (
          playback.playing &&
          playback.rate > 0 &&
          engine.isTransportDrifted(playhead, playback.rate)
        ) {
          start();
        }
      },
    );
    const offMedia = useProjectStore.subscribe(
      (state) => state.project.mediaLibrary,
      (mediaLibrary, previous) => {
        const assets = new Map(mediaLibrary.map((asset) => [asset.id, asset]));
        let changed = false;
        for (const asset of previous) {
          // Relink can replace bytes under the same OPFS key and size. Treat
          // changed records conservatively, including metadata-only edits.
          if (assets.get(asset.id) !== asset) {
            engine.forget(asset.id);
            changed = true;
          }
        }
        engine.retain(new Set(assets.keys()));
        if (changed && usePlaybackStore.getState().playing) start();
      },
    );

    const rescheduleEdit = () => {
      const state = useProjectStore.getState();
      if (state.precisionEditing) return;
      const key = playbackKey(state.project);
      if (key === scheduledKey) return;
      scheduledKey = key;
      if (usePlaybackStore.getState().playing) start();
    };
    const offRouting = useProjectStore.subscribe(
      (state) => [state.project.timeline.tracks, state.project.audio] as const,
      () => engine.updateRouting(useProjectStore.getState().project),
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    );
    const offClips = useProjectStore.subscribe(
      (state) =>
        [state.project.timeline.tracks, state.project.timelines, state.project.audio] as const,
      rescheduleEdit,
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] },
    );
    const offPrecision = useProjectStore.subscribe(
      (state) => state.precisionEditing,
      rescheduleEdit,
    );

    if (usePlaybackStore.getState().playing) start();
    return () => {
      disposePitchWorkers();
      offPlayback();
      offPlayhead();
      offMedia();
      offClips();
      offRouting();
      offPrecision();
      engine.stop();
    };
  }, []);
}
