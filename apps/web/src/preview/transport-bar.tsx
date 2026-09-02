"use client";

import { Pause, Play, SkipBack, SkipForward, Scissors, Camera } from "lucide-react";
import { formatTimecode } from "@movie-desk/core";
import { useProjectStore, selectPlayhead, selectDuration } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useSelectionStore } from "@/stores/selection-store";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t";
import { LevelMeter } from "./level-meter";
import { exportStillFrame } from "@/export/still";

export function TransportBar() {
  const playing = usePlaybackStore((s) => s.playing);
  const toggle = usePlaybackStore((s) => s.toggle);
  const playhead = useProjectStore(selectPlayhead);
  const duration = useProjectStore(selectDuration);
  const setPlayhead = useProjectStore((s) => s.setPlayheadMs);
  const fps = useProjectStore((s) => s.project.framerate);
  const splitAt = useProjectStore((s) => s.splitAt);
  const selectedClips = useSelectionStore((s) => s.clipIds);
  const t = useT();

  const onSplit = () => {
    for (const id of selectedClips) splitAt(id, playhead);
  };

  const onStill = async () => {
    try {
      await exportStillFrame();
    } catch {
      toast.error(t("still.failed"));
    }
  };

  return (
    <div className="flex h-full items-center justify-between gap-3 px-3">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          className="btn-ghost px-2 py-1.5"
          onClick={() => setPlayhead(0)}
          aria-label={t("transport.goToStart")}
          title={t("transport.goToStart")}
        >
          <SkipBack className="size-4" />
        </button>
        <button
          type="button"
          className="btn-primary size-8 min-h-8 rounded-full px-0"
          onClick={toggle}
          aria-label={playing ? t("transport.pause") : t("transport.play")}
          title={playing ? t("transport.pause") : t("transport.play")}
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </button>
        <button
          type="button"
          className="btn-ghost px-2 py-1.5"
          onClick={() => setPlayhead(duration)}
          aria-label={t("transport.goToEnd")}
          title={t("transport.goToEnd")}
        >
          <SkipForward className="size-4" />
        </button>
        <div className="mx-1.5 h-4 w-px bg-line" />
        <button
          type="button"
          className="btn-ghost"
          onClick={onSplit}
          disabled={selectedClips.size === 0}
          title={t("transport.splitHint")}
        >
          <Scissors className="size-4" />
          {t("transport.split")}
        </button>
        <button type="button" className="btn-ghost" onClick={onStill} title={t("still.capture")}>
          <Camera className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <LevelMeter />
        <div className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-2xs text-ink-2">
          <span className="text-ink-1">{formatTimecode(playhead, fps)}</span>
          <span className="mx-1 text-ink-3">/</span>
          <span>{formatTimecode(duration, fps)}</span>
        </div>
      </div>
    </div>
  );
}
