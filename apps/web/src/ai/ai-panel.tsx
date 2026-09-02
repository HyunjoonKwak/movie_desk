"use client";

import { useState } from "react";
import { Crosshair, Loader2, ScissorsSquare, Scissors, Scan, Sparkles, Type, Music, Droplet } from "lucide-react";
import { toast } from "sonner";
import { isMediaClip, type ID } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { useSelectionStore } from "@/stores/selection-store";
import { InspectorSection } from "@/components/inspector-section";
import { readMediaFile } from "@/persistence/opfs";
import { useT, t as tFn } from "@/i18n/use-t";
import { detectSilenceFromBlob } from "./silence-detect";
import { removeSilentRangesFromClip } from "./auto-cut";
import { transcribeAudio } from "./transcribe";
import { subtitlesToClips } from "./subtitles-to-clips";
import { detectScenesFromBlob } from "./scene-detect";
import { applySceneCuts } from "./apply-scene-cuts";
import { addBackgroundRemovalEffect } from "./bg-remove";
import { trackRegion } from "./motion-track";
import { applyMotionTrack } from "./apply-motion-track";
import { detectBeatsFromBlob } from "./beat-detect";
import { computeAutoWhiteBalance } from "./auto-white-balance";
import { useTrackRegionStore } from "@/preview/track-region-store";

type RunKey = null | "silence" | "whisper" | "scene" | "bgrm" | "track" | "beats" | "awb";

export function AiPanel() {
  const [running, setRunning] = useState<RunKey>(null);
  const selectedIds = useSelectionStore((s) => s.clipIds);
  const firstSelected = [...selectedIds][0];
  const t = useT();

  const withClip = async <T,>(
    fn: (clipId: ID) => Promise<T>,
  ): Promise<T | undefined> => {
    if (!firstSelected) {
      toast.error(tFn("ai.selectClip"));
      return undefined;
    }
    return fn(firstSelected);
  };

  const runAutoSilenceCut = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset) return;
      setRunning("silence");
      const toastId = toast.loading(tFn("ai.silence.analyzing"));
      try {
        const blob = await readMediaFile(asset.opfsPath);
        if (!blob) throw new Error(tFn("ai.assetMissing"));
        const ranges = await detectSilenceFromBlob(blob);
        if (ranges.length === 0) {
          toast.info(tFn("ai.silence.none"), { id: toastId });
          return;
        }
        const before = useProjectStore.getState().project;
        const after = removeSilentRangesFromClip(before, id, ranges);
        useProjectStore.setState({ project: after });
        toast.success(tFn("ai.silence.removed", { n: ranges.length }), { id: toastId });
      } catch (err) {
        toast.error(tFn("ai.silence.failed", { msg: errMsg(err) }), { id: toastId });
      } finally {
        setRunning(null);
      }
    });

  const runWhisper = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset) return;
      setRunning("whisper");
      const toastId = toast.loading(tFn("ai.subtitles.loading"));
      try {
        const blob = await readMediaFile(asset.opfsPath);
        if (!blob) throw new Error(tFn("ai.assetMissing"));
        const subs = await transcribeAudio(blob, (label, pct) => {
          toast.loading(`${label}… ${Math.round(pct * 100)}%`, { id: toastId });
        });
        if (subs.length === 0) {
          toast.info(tFn("ai.subtitles.none"), { id: toastId });
          return;
        }
        const after = subtitlesToClips(useProjectStore.getState().project, clip, subs);
        useProjectStore.setState({ project: after });
        toast.success(tFn("ai.subtitles.added", { n: subs.length }), { id: toastId });
      } catch (err) {
        toast.error(tFn("ai.subtitles.failed", { msg: errMsg(err) }), { id: toastId });
      } finally {
        setRunning(null);
      }
    });

  const runSceneDetect = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset || asset.kind !== "video") {
        toast.error(tFn("ai.scene.selectVideo"));
        return;
      }
      setRunning("scene");
      const toastId = toast.loading(tFn("ai.scene.scanning"));
      try {
        const blob = await readMediaFile(asset.opfsPath);
        if (!blob) throw new Error(tFn("ai.assetMissing"));
        const scenes = await detectScenesFromBlob(blob, (pct) => {
          toast.loading(tFn("ai.scene.scanningPct", { n: Math.round(pct * 100) }), { id: toastId });
        });
        if (scenes.length === 0) {
          toast.info(tFn("ai.scene.none"), { id: toastId });
          return;
        }
        const after = applySceneCuts(useProjectStore.getState().project, id, clip, scenes);
        useProjectStore.setState({ project: after });
        toast.success(tFn("ai.scene.found", { n: scenes.length }), { id: toastId });
      } catch (err) {
        toast.error(tFn("ai.scene.failed", { msg: errMsg(err) }), { id: toastId });
      } finally {
        setRunning(null);
      }
    });

  const runBgRemove = () =>
    withClip(async (id) => {
      const { clip } = await getMediaClipOrToast(id);
      if (!clip) return;
      setRunning("bgrm");
      try {
        const after = addBackgroundRemovalEffect(useProjectStore.getState().project, id);
        useProjectStore.setState({ project: after });
        toast.success(tFn("ai.bgrm.added"));
      } catch (err) {
        toast.error(tFn("ai.bgrm.failed", { msg: errMsg(err) }));
      } finally {
        setRunning(null);
      }
    });

  const runMotionTrack = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset || asset.kind !== "video") {
        toast.error(tFn("ai.track.selectVideo"));
        return;
      }
      setRunning("track");
      const toastId = toast.loading(tFn("ai.track.tracking"));
      try {
        const blob = await readMediaFile(asset.opfsPath);
        if (!blob) throw new Error(tFn("ai.assetMissing"));
        // Use the user-drawn region if present, else a centered default box.
        const drawn = useTrackRegionStore.getState().region;
        const region =
          drawn && drawn.w > 0.02 && drawn.h > 0.02
            ? drawn
            : { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
        const points = await trackRegion(
          blob,
          region,
          clip.trimIn,
          clip.trimIn + clip.duration / clip.speed,
          5,
          (pct) => toast.loading(tFn("ai.track.trackingPct", { n: Math.round(pct * 100) }), { id: toastId }),
        );
        if (points.length < 2) {
          toast.info(tFn("ai.track.none"), { id: toastId });
          return;
        }
        const after = applyMotionTrack(useProjectStore.getState().project, clip, points);
        useProjectStore.setState({ project: after });
        toast.success(tFn("ai.track.done", { n: points.length }), { id: toastId });
      } catch (err) {
        toast.error(tFn("ai.track.failed", { msg: errMsg(err) }), { id: toastId });
      } finally {
        setRunning(null);
      }
    });

  const runBeatMarkers = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset) return;
      setRunning("beats");
      const toastId = toast.loading(tFn("ai.beats.analyzing"));
      try {
        const blob = await readMediaFile(asset.opfsPath);
        if (!blob) throw new Error(tFn("ai.assetMissing"));
        const beats = await detectBeatsFromBlob(blob);
        // Map source-relative beats onto the timeline, keeping only those that
        // fall inside the clip's visible source window.
        const store = useProjectStore.getState();
        let added = 0;
        for (const srcMs of beats) {
          if (srcMs < clip.trimIn || srcMs > clip.trimOut) continue;
          const timelineMs = clip.start + (srcMs - clip.trimIn) / clip.speed;
          store.addMarkerAt(Math.round(timelineMs), "");
          added++;
          if (added >= 300) break;
        }
        if (added === 0) toast.info(tFn("ai.beats.none"), { id: toastId });
        else toast.success(tFn("ai.beats.added", { n: added }), { id: toastId });
      } catch (err) {
        toast.error(tFn("ai.beats.failed", { msg: errMsg(err) }), { id: toastId });
      } finally {
        setRunning(null);
      }
    });

  const runAutoWhiteBalance = () =>
    withClip(async (id) => {
      const { clip, asset } = await getMediaClipOrToast(id);
      if (!clip || !asset || asset.kind === "audio") {
        toast.error(tFn("ai.awb.selectVisual"));
        return;
      }
      setRunning("awb");
      try {
        const wb = await computeAutoWhiteBalance();
        if (!wb) {
          toast.info(tFn("ai.awb.none"));
          return;
        }
        useProjectStore.getState().upsertEffectFor(id, "white-balance", {
          temperature: wb.temperature,
          tint: wb.tint,
        });
        toast.success(tFn("ai.awb.done"));
      } catch (err) {
        toast.error(tFn("ai.awb.failed", { msg: errMsg(err) }));
      } finally {
        setRunning(null);
      }
    });

  return (
    <InspectorSection
      title={t("ai.title")}
      icon={<Sparkles className="size-3" />}
      defaultOpen={false}
    >
      <AiButton
        onClick={runAutoSilenceCut}
        disabled={!firstSelected || running !== null}
        running={running === "silence"}
        icon={ScissorsSquare}
        label={t("ai.silence")}
        badge="local"
        title={t("ai.silence.hint")}
      />
      <AiButton
        onClick={runWhisper}
        disabled={!firstSelected || running !== null}
        running={running === "whisper"}
        icon={Type}
        label={t("ai.subtitles")}
        badge="~40MB"
        title={t("ai.subtitles.hint")}
      />
      <AiButton
        onClick={runSceneDetect}
        disabled={!firstSelected || running !== null}
        running={running === "scene"}
        icon={Scissors}
        label={t("ai.scene")}
        badge="local"
        title={t("ai.scene.hint")}
      />
      <AiButton
        onClick={runBgRemove}
        disabled={!firstSelected || running !== null}
        running={running === "bgrm"}
        icon={Scan}
        label={t("ai.bgrm")}
        badge="MediaPipe"
        title={t("ai.bgrm.hint")}
      />
      <AiButton
        onClick={runMotionTrack}
        disabled={!firstSelected || running !== null}
        running={running === "track"}
        icon={Crosshair}
        label={t("ai.track")}
        badge="local"
        title={t("ai.track.hint")}
      />
      <AiButton
        onClick={runBeatMarkers}
        disabled={!firstSelected || running !== null}
        running={running === "beats"}
        icon={Music}
        label={t("ai.beats")}
        badge="local"
        title={t("ai.beats.hint")}
      />
      <AiButton
        onClick={runAutoWhiteBalance}
        disabled={!firstSelected || running !== null}
        running={running === "awb"}
        icon={Droplet}
        label={t("ai.awb")}
        badge="local"
        title={t("ai.awb.hint")}
      />
      <button
        type="button"
        onClick={() => useTrackRegionStore.getState().setSelecting(true)}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-white/10 bg-transparent px-3 py-1.5 text-2xs text-ink-3 hover:border-accent hover:text-accent"
      >
        <Crosshair className="size-3" />
        {t("ai.track.drawRegion")}
      </button>
    </InspectorSection>
  );
}

interface AiBtnProps {
  onClick: () => void;
  disabled: boolean;
  running: boolean;
  icon: typeof Sparkles;
  label: string;
  badge: string;
  title: string;
}

function AiButton({ onClick, disabled, running, icon: Icon, label, badge, title }: AiBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md border border-white/5 bg-panel-2 px-3 py-2 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
      title={title}
    >
      {running ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4 text-accent" />}
      <span className="flex-1 text-left">{label}</span>
      <span className="text-3xs text-ink-3">{badge}</span>
    </button>
  );
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const getMediaClipOrToast = async (id: ID) => {
  const store = useProjectStore.getState();
  const clip = store.project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === id);
  if (!clip || !isMediaClip(clip)) {
    toast.error(tFn("ai.selectMedia"));
    return { clip: null, asset: null };
  }
  const asset = store.project.mediaLibrary.find((a) => a.id === clip.assetId);
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) {
    toast.error(tFn("ai.noAudio"));
    return { clip, asset: null };
  }
  return { clip, asset };
};
