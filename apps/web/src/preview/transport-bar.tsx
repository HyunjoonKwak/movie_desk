"use client";

import { PrecisionInput } from "@/components/precision-input";
import { exportStillFrame } from "@/export/still";
import { useT } from "@/i18n/use-t";
import {
  selectDuration,
  selectPlayhead,
  useEditorStore as useProjectStore,
} from "@/stores/editor-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import { formatTimecode } from "@movie-desk/core";
import { Camera, Pause, Play, Scissors, SkipBack, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { LevelMeter } from "./level-meter";

export function TransportBar() {
  const timelinePlaying = usePlaybackStore((s) => s.playing);
  const timelineToggle = usePlaybackStore((s) => s.toggle);
  const timelinePlayhead = useProjectStore(selectPlayhead);
  const timelineDuration = useProjectStore(selectDuration);
  const setTimelinePlayhead = useProjectStore((s) => s.setPlayheadMs);
  const fps = useProjectStore((s) => s.project.framerate);
  // While the viewer shows a source, the transport drives that source; the
  // clip tools stay with the timeline and pause until it is back.
  const source = useSourceViewerStore();
  const sourceAsset = useProjectStore((s) =>
    source.assetId ? s.project.mediaLibrary.find((a) => a.id === source.assetId) : undefined,
  );
  const inSource = sourceAsset !== undefined;
  const playing = inSource ? source.playing : timelinePlaying;
  const toggle = inSource ? source.toggle : timelineToggle;
  const playhead = inSource ? source.playheadMs : timelinePlayhead;
  const duration = inSource ? Math.max(1, sourceAsset.durationMs) : timelineDuration;
  const setPlayhead = inSource ? source.setPlayhead : setTimelinePlayhead;
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
    <div
      className="flex h-full items-center justify-between gap-3 px-3"
      data-transport-mode={inSource ? "source" : "timeline"}
    >
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
          disabled={inSource || selectedClips.size === 0}
          title={t("transport.splitHint")}
        >
          <Scissors className="size-4" />
          {t("transport.split")}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onStill}
          disabled={inSource}
          title={t("still.capture")}
        >
          <Camera className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <LevelMeter />
        <div className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-2xs text-ink-2">
          <PrecisionInput
            label={t("precision.playhead")}
            value={playhead}
            fps={fps}
            min={0}
            max={duration}
            onChange={setPlayhead}
          />
          <span className="mx-1 text-ink-3">/</span>
          <span>{formatTimecode(duration, fps)}</span>
        </div>
      </div>
    </div>
  );
}
