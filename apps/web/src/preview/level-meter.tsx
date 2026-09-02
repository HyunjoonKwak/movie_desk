"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ID } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { playheadLevel } from "./playhead-level";

// Compact peak meter reflecting the audio level at the playhead. Decays
// smoothly so it reads like a VU meter during playback.
export function LevelMeter() {
  const playing = usePlaybackStore((s) => s.playing);
  const playhead = useProjectStore((s) => s.project.timeline.playhead);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const [level, setLevel] = useState(0);
  const decayed = useRef(0);

  const getAsset = useMemo(() => {
    const map = new Map(media.map((a) => [a.id, a]));
    return (id: ID) => map.get(id);
  }, [media]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: playhead/playing are intentional ticks — the project is read fresh from the store inside.
  useEffect(() => {
    const target = playheadLevel(useProjectStore.getState().project, getAsset);
    // Fast attack, slow release for a meter-like feel.
    decayed.current = target > decayed.current ? target : decayed.current * 0.8 + target * 0.2;
    setLevel(decayed.current);
  }, [playhead, playing, getAsset]);

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
