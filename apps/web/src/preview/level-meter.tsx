"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type ID, isMediaClip } from "@movie-desk/core";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { playheadLevel } from "./playhead-level";
import { requestWaveforms, usePreviewStore } from "@/stores/preview-store";

// Compact peak meter reflecting the audio level at the playhead. Decays
// smoothly so it reads like a VU meter during playback.
export function LevelMeter() {
  const playing = usePlaybackStore((s) => s.playing);
  const playhead = useProjectStore((s) => s.project.timeline.playhead);
  const tracks = useProjectStore((s) => s.project.timeline.tracks);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const [level, setLevel] = useState(0);
  const decayed = useRef(0);

  const waveformAssetIds = useMemo(() => {
    const referenced = new Set(
      tracks.flatMap((track) =>
        track.clips.filter(isMediaClip).map((clip) => clip.assetId),
      ),
    );
    return media
      .filter((asset) => referenced.has(asset.id) && asset.hasAudio !== false)
      .map((asset) => asset.id)
      .sort();
  }, [media, tracks]);
  const waveformAssetKey = waveformAssetIds.join("\0");
  const waveforms = usePreviewStore(
    useShallow((state) =>
      Object.fromEntries(waveformAssetIds.map((id) => [id, state.waveforms[id]])),
    ),
  );

  const getAsset = useMemo(() => {
    const map = new Map(media.map((a) => [a.id, a]));
    return (id: ID) => map.get(id);
  }, [media]);

  useEffect(() => {
    requestWaveforms(waveformAssetKey ? waveformAssetKey.split("\0") : []);
  }, [waveformAssetKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: playhead/playing are intentional ticks — the project is read fresh from the store inside.
  useEffect(() => {
    const target = playheadLevel(
      useProjectStore.getState().project,
      getAsset,
      (id) => getAsset(id)?.waveformPeaks ?? waveforms[id],
    );
    // Fast attack, slow release for a meter-like feel.
    decayed.current = target > decayed.current ? target : decayed.current * 0.8 + target * 0.2;
    setLevel(decayed.current);
  }, [playhead, playing, getAsset, waveforms]);

  const pct = Math.round(level * 100);
  // dBFS-ish color zones: green up to ~-6, amber to ~-1.5, red near clipping.
  const color = level > 0.92 ? "bg-red-500" : level > 0.7 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-1" title={`${pct}%`} aria-label="audio level">
      <div className="h-2 w-24 overflow-hidden rounded-sm bg-white/10">
        <div className={`h-full ${color} transition-[width] duration-75`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
