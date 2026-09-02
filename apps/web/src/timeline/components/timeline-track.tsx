"use client";

import { useCallback, useState } from "react";
import { Headphones, Lock, Trash2, Unlock, Volume2, VolumeX } from "lucide-react";
import type { Track } from "@movie-desk/core";
import { collectSnapPoints, newId, resolvePlacement, snapMsToFrame, snapToNearest } from "@movie-desk/core";
import { useProjectStore, selectZoom } from "@/stores/project-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { useT } from "@/i18n/use-t";
import { TimelineClip } from "./timeline-clip";
import { TRACK_HEADER_W } from "../constants";
import { cn } from "@/lib/cn";

interface Props {
  track: Track;
  width: number;
}

export function TimelineTrack({ track, width }: Props) {
  const zoom = useProjectStore(selectZoom);
  const toggleMute = useProjectStore((s) => s.toggleTrackMute);
  const toggleSolo = useProjectStore((s) => s.toggleTrackSolo);
  const toggleLock = useProjectStore((s) => s.toggleTrackLock);
  const removeTrack = useProjectStore((s) => s.removeTrackById);
  const dragAssetId = useTimelineUiStore((s) => s.dragAssetId);
  const t = useT();

  // Media-bin drag & drop. The dragged asset id comes from the transient
  // UI store (dataTransfer is unreadable during dragover).
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const dragAsset = useProjectStore((s) =>
    dragAssetId ? s.project.mediaLibrary.find((a) => a.id === dragAssetId) ?? null : null,
  );
  const accepts =
    !!dragAsset && !track.locked && track.kind === (dragAsset.kind === "audio" ? "audio" : "video");

  const dropMsFromEvent = useCallback(
    (e: React.DragEvent<HTMLDivElement>, durationMs: number): number => {
      const rect = e.currentTarget.getBoundingClientRect();
      const raw = Math.max(0, (e.clientX - rect.left) / zoom);
      const p = useProjectStore.getState().project;
      // Magnetise to clip edges / markers / playhead, frame-snap, then
      // clamp into a free gap (clips never overlap).
      const snapped = useTimelineUiStore.getState().snapEnabled
        ? snapToNearest(raw, collectSnapPoints(p.timeline), 8 / Math.max(zoom, 0.001))
        : raw;
      const framed = snapMsToFrame(snapped, p.framerate);
      const current = p.timeline.tracks.find((t) => t.id === track.id);
      return current ? resolvePlacement(current.clips, durationMs, framed) : framed;
    },
    [zoom, track.id],
  );

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!accepts) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (dragAsset) setPreviewMs(dropMsFromEvent(e, dragAsset.durationMs));
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!accepts || !dragAsset) return;
    e.preventDefault();
    // 사용 구간이 지정된 자산은 그 구간만 배치한다.
    const inMs = dragAsset.useInMs ?? 0;
    const outMs = dragAsset.useOutMs ?? dragAsset.durationMs;
    const useMs = Math.max(200, outMs - inMs);
    const start = dropMsFromEvent(e, useMs);
    useProjectStore.getState().addClipToTrack(track.id, {
      kind: "media",
      id: newId(),
      assetId: dragAsset.id,
      start,
      duration: useMs,
      trimIn: inMs,
      trimOut: outMs,
      speed: 1,
      effects: [],
      keyframes: [],
    });
    setPreviewMs(null);
    useTimelineUiStore.getState().setDragAssetId(null);
  };

  return (
    <div className="flex items-stretch gap-0" data-track={track.id} data-track-kind={track.kind}>
      <div
        className={cn(
          "group sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1",
          "border-y border-r border-white/5 bg-panel-2 px-2 text-xs",
        )}
        style={{ height: track.height, width: TRACK_HEADER_W }}
      >
        <span className="font-medium text-ink-1">{track.name}</span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className="rounded p-0.5 text-ink-3 hover:bg-white/10 hover:text-ink-1"
            onClick={() => toggleMute(track.id)}
            title={track.muted ? t("timeline.unmute") : t("timeline.mute")}
          >
            {track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
          </button>
          <button
            type="button"
            className={cn(
              "rounded p-0.5 hover:bg-white/10 hover:text-ink-1",
              track.solo ? "text-amber-400" : "text-ink-3",
            )}
            onClick={() => toggleSolo(track.id)}
            title={track.solo ? t("timeline.unsolo") : t("timeline.solo")}
          >
            <Headphones className="size-3" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-ink-3 hover:bg-white/10 hover:text-ink-1"
            onClick={() => toggleLock(track.id)}
            title={track.locked ? t("timeline.unlock") : t("timeline.lock")}
          >
            {track.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-ink-3 opacity-0 hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
            onClick={() => removeTrack(track.id)}
            title={t("timeline.deleteTrack")}
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </div>
      <div
        className={cn(
          "relative border-y border-white/5 bg-panel-2/40",
          accepts && "bg-accent/5",
        )}
        style={{ width: width - TRACK_HEADER_W, height: track.height }}
        onDragOver={onDragOver}
        onDragLeave={() => setPreviewMs(null)}
        onDrop={onDrop}
      >
        <GridLines width={width - TRACK_HEADER_W} zoom={zoom} />
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            trackHeight={track.height}
            trackLocked={track.locked}
          />
        ))}
        {accepts && previewMs !== null && dragAsset && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-accent/60 bg-accent/20"
            style={{
              left: previewMs * zoom,
              width: Math.max(2, dragAsset.durationMs * zoom),
              height: track.height - 8,
            }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function GridLines({ width, zoom }: { width: number; zoom: number }) {
  const step = 1000;
  const count = Math.ceil(width / (step * zoom));
  return (
    <svg className="absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const x = i * step * zoom;
        return (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={0}
            y2="100%"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}
