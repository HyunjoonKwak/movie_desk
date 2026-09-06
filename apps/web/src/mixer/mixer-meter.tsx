"use client";

import { useEffect, useMemo } from "react";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { requestWaveforms, retainWaveform, usePreviewStore } from "@/stores/preview-store";
import { estimatedLevels } from "./estimated-levels";
import { StateHint } from "@/components/state-hint";
import { useT } from "@/i18n/use-t";
import { useMeterStore } from "./meter-store";

const db = (value: number) => (value > 0 ? Math.max(-60, 20 * Math.log10(value)) : -60);
const display = (value: number) => (value > 0 ? (20 * Math.log10(value)).toFixed(1) : "−∞");

export function MixerMeter({ id, compact = false }: { id: string; compact?: boolean }) {
  const t = useT();
  const playing = usePlaybackStore((s) => s.playing);
  const measured = useMeterStore((s) => s.levels[id]);
  const live = useMeterStore((s) => s.live);
  const measuring = playing && live;
  const allTracks = useProjectStore((s) => s.project.timeline.tracks);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const audio = useProjectStore((s) => s.project.audio);
  const playhead = useProjectStore((s) => (measuring ? 0 : s.project.timeline.playhead));
  const waveforms = usePreviewStore((s) => s.waveforms);
  const assetKey = useMemo(
    () =>
      id === "master"
        ? [
            ...new Set(
              allTracks.flatMap((track) =>
                track.clips.flatMap((clip) => (clip.kind === "media" ? [clip.assetId] : [])),
              ),
            ),
          ]
            .sort()
            .join("\0")
        : "",
    [id, allTracks],
  );
  useEffect(() => {
    const ids = assetKey ? assetKey.split("\0") : [];
    const releases = ids.map(retainWaveform);
    requestWaveforms(ids);
    return () => {
      for (const release of releases) release();
    };
  }, [assetKey]);
  // Read the project only on stopped-view or routing changes, never on a live playhead tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies invalidate the fresh store snapshot below.
  const estimate = useMemo(() => {
    if (measuring) return 0;
    return estimatedLevels(useProjectStore.getState().project, waveforms)[id] ?? 0;
  }, [measuring, allTracks, media, audio, playhead, id, waveforms]);
  const peak = measuring ? (measured?.peak ?? 0) : estimate;
  const held = measuring ? (measured?.heldPeak ?? 0) : estimate;
  const clipping = measuring && measured?.clipping;
  const source = t(measuring ? "mixer.live" : "mixer.estimated");
  return (
    <div
      title={`${source} · ${t("mixer.peak")} ${display(peak)} dBFS`}
      className={compact ? "w-8 shrink-0" : "space-y-1"}
    >
      <div
        role="meter"
        aria-label={`${source} ${id}`}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={Math.min(0, db(peak))}
        aria-valuetext={`${display(peak)} dBFS`}
        className="relative h-2 overflow-hidden rounded bg-white/10"
      >
        <div
          className={`h-full ${clipping ? "bg-red-500" : peak > 0.7 ? "bg-amber-400" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, ((db(peak) + 60) / 60) * 100)}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-white"
          style={{ left: `${Math.min(99, ((db(held) + 60) / 60) * 100)}%` }}
        />
      </div>
      {!compact && (
        <>
          <div className="text-3xs text-ink-3">{source} · −60 … 0 dBFS</div>
          <div className="font-mono text-3xs">
            {t("mixer.peak")} {display(held)} dBFS
          </div>
          {measuring && (
            <div className="font-mono text-3xs">
              {t("mixer.rms")} {display(measured?.rms ?? 0)} dBFS
            </div>
          )}
          {id === "master" && measuring && (
            <div className="font-mono text-3xs">
              {t("mixer.shortLufs")}{" "}
              {measured?.shortLufs == null ? "—" : measured.shortLufs.toFixed(1)}
            </div>
          )}
          {clipping && <StateHint tone="warning" text={t("mixer.clipping")} />}
        </>
      )}
    </div>
  );
}
