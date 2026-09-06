"use client";

import { pitchPlaybackKey } from "@/audio/pitch-renderer";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useEffect } from "react";
import { getAudioEngine } from "./audio-engine";

// Bridges the playback store to the audio engine: start monitoring from the
// current playhead when play begins (or the rate changes), stop on pause.
// Playhead advances are intentionally NOT a dependency — the engine schedules
// once from the start position and the AudioContext clock carries it, in step
// with the rAF picture loop in PreviewViewport.
export function useAudioPlayback(): void {
  useEffect(() => {
    const engine = getAudioEngine();
    let scheduledKey = pitchPlaybackKey(useProjectStore.getState().project.timeline.tracks);
    const start = () => {
      const playback = usePlaybackStore.getState();
      const project = useProjectStore.getState().project;
      scheduledKey = pitchPlaybackKey(project.timeline.tracks);
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
      const key = pitchPlaybackKey(state.project.timeline.tracks);
      if (key === scheduledKey) return;
      scheduledKey = key;
      if (usePlaybackStore.getState().playing) start();
    };
    const offClips = useProjectStore.subscribe(
      (state) => state.project.timeline.tracks,
      rescheduleEdit,
    );
    const offPrecision = useProjectStore.subscribe(
      (state) => state.precisionEditing,
      rescheduleEdit,
    );

    if (usePlaybackStore.getState().playing) start();
    return () => {
      offPlayback();
      offPlayhead();
      offMedia();
      offClips();
      offPrecision();
      engine.stop();
    };
  }, []);
}
