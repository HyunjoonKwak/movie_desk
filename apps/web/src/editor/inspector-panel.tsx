"use client";

import { useMemo } from "react";
import { Sliders } from "lucide-react";
import { findClip, isMediaClip, isTextClip, isShapeClip } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { useSelectionStore } from "@/stores/selection-store";
import { EffectsSection } from "./effects-section";
import { TextSection } from "./text-section";
import { ShapeSection } from "./shape-section";
import { TransformSection } from "./transform-section";
import { MaskSection } from "./mask-section";
import { TransitionSection } from "./transition-section";
import { SpeedSection } from "./speed-section";
import { SlipSection } from "./slip-section";
import { AudioSection } from "./audio-section";
import { KeyframeGraph } from "./keyframe-graph";
import { AiPanel } from "@/ai/ai-panel";
import { InspectorSection } from "@/components/inspector-section";
import { NumberScrubber } from "@/components/number-scrubber";
import { useT } from "@/i18n/use-t";

export function InspectorPanel() {
  const timeline = useProjectStore((s) => s.project.timeline);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const setClipStartMs = useProjectStore((s) => s.setClipStartMs);
  const trimEnd = useProjectStore((s) => s.trimEnd);
  const setClipSpeed = useProjectStore((s) => s.setClipSpeed);
  const selected = useSelectionStore((s) => s.clipIds);
  const t = useT();

  const clip = useMemo(() => {
    const first = [...selected][0];
    if (!first) return null;
    return findClip(timeline, first) ?? null;
  }, [timeline, selected]);

  const asset = useMemo(() => {
    if (!clip || !isMediaClip(clip)) return null;
    return media.find((a) => a.id === clip.assetId) ?? null;
  }, [clip, media]);

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <Sliders className="size-3.5" />
          {t("inspector.title")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {!clip && (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-panel-2 text-ink-3">
              <Sliders className="size-4" />
            </span>
            <p className="max-w-48 text-xs leading-5 text-ink-3">{t("inspector.empty")}</p>
          </div>
        )}

        {clip && (
          <div className="space-y-3">
            <InspectorSection title={t("inspector.info")}>
              <dl className="space-y-2">
                <Row label={t("inspector.kind")} value={clip.kind} />
                <EditableRow label={t("inspector.start")}>
                  <NumberScrubber
                    value={clip.start}
                    onChange={(v) => setClipStartMs(clip.id, v)}
                    min={0}
                    step={10}
                    commitOnRelease
                    format={(v) => `${Math.round(v)} ms`}
                  />
                </EditableRow>
                <EditableRow label={t("inspector.duration")}>
                  <NumberScrubber
                    value={clip.duration}
                    onChange={(v) => trimEnd(clip.id, clip.start + v)}
                    min={1}
                    step={10}
                    commitOnRelease
                    format={(v) => `${Math.round(v)} ms`}
                  />
                </EditableRow>
                <EditableRow label={t("inspector.speed")}>
                  <NumberScrubber
                    value={clip.speed}
                    onChange={(v) => setClipSpeed(clip.id, v)}
                    min={0.1}
                    max={8}
                    step={0.01}
                    commitOnRelease
                    format={(v) => `${v.toFixed(2)}x`}
                  />
                </EditableRow>
                {asset && (
                  <>
                    <Row label={t("inspector.asset")} value={asset.name} />
                    <Row label={t("inspector.assetDuration")} value={`${asset.durationMs} ms`} />
                    {asset.width && asset.height && (
                      <Row
                        label={t("inspector.resolution")}
                        value={`${asset.width}×${asset.height}`}
                      />
                    )}
                  </>
                )}
              </dl>
            </InspectorSection>
            {isTextClip(clip) && <TextSection clip={clip} />}
            {isShapeClip(clip) && <ShapeSection clip={clip} />}
            <TransformSection clipId={clip.id} clip={clip} />
            <MaskSection clipId={clip.id} clip={clip} />
            {isMediaClip(clip) && (
              <>
                <SpeedSection clipId={clip.id} clip={clip} />
                <SlipSection clip={clip} />
                <AudioSection clip={clip} />
              </>
            )}
            <TransitionSection clipId={clip.id} clip={clip} />
            <EffectsSection clipId={clip.id} effects={clip.effects} />
            {clip.keyframes.length > 0 && <KeyframeGraph clipId={clip.id} clip={clip} />}
            <AiPanel />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="font-mono text-xs text-ink-1">{value}</dd>
    </div>
  );
}

function EditableRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
