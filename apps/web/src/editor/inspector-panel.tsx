"use client";

import { useMemo } from "react";
import { Sliders } from "lucide-react";
import { formatTimecode, findClip, isMediaClip, hasSourceTrim, isTextClip, isShapeClip } from "@movie-desk/core";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
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
import { PrecisionInput } from "@/components/precision-input";
import { useT } from "@/i18n/use-t";

import { StateHint } from "@/components/state-hint";

export function InspectorPanel() {
  const fps = useProjectStore((s) => s.project.framerate);
  const timeline = useProjectStore((s) => s.project.timeline);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const setClipStartMs = useProjectStore((s) => s.setClipStartMs);
  const trimEnd = useProjectStore((s) => s.trimEnd);
  const previewSpeed = useProjectStore((s) => s.previewClipSpeed);
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
        {!clip && <StateHint testId="inspector-empty-hint" text={t("state.inspector.empty")} />}
        {clip && selected.size > 1 && (
          <StateHint text={t("state.inspector.multipleFirstSelected", { n: selected.size })} />
        )}

        {clip && (
          <div className="space-y-3">
            <InspectorSection title={t("inspector.info")}>
              <dl className="space-y-2">
                <Row label={t("inspector.kind")} value={clip.kind} />
                <EditableRow label={t("inspector.start")}>
                  <PrecisionInput
                    key={clip.id}
                    label={t("inspector.start")}
                    fps={fps}
                    value={clip.start}
                    onChange={(v) => setClipStartMs(clip.id, v)}
                    min={0}
                  />
                </EditableRow>
                <EditableRow label={t("inspector.duration")}>
                  <PrecisionInput
                    key={clip.id}
                    label={t("inspector.duration")}
                    fps={fps}
                    value={clip.duration}
                    onChange={(v) => trimEnd(clip.id, clip.start + v)}
                    min={1000 / fps}
                  />
                </EditableRow>
                <EditableRow label={t("inspector.speed")}>
                  <PrecisionInput
                    key={clip.id}
                    label={t("inspector.speed")}
                    unit="×"
                    onPreview={(v) => previewSpeed(clip.id, v)}
                    value={clip.speed}
                    onChange={(v) => setClipSpeed(clip.id, v)}
                    min={0.1}
                    max={8}
                    step={0.01}
                  />
                </EditableRow>
                {asset && (
                  <>
                    <Row label={t("inspector.asset")} value={asset.name} />
                    <Row
                      label={t("inspector.assetDuration")}
                      value={formatTimecode(asset.durationMs, fps)}
                    />
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
            {hasSourceTrim(clip) && (
              <>
                <SpeedSection clipId={clip.id} clip={clip} />
                <SlipSection clip={clip} />
                {isMediaClip(clip) && <AudioSection clip={clip} />}
              </>
            )}
            <TransitionSection clipId={clip.id} clip={clip} />
            <EffectsSection clipId={clip.id} effects={clip.effects} />
            {clip.keyframes.length > 0 && (
              <KeyframeGraph key={clip.id} clipId={clip.id} clip={clip} />
            )}
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
      <dt className="shrink-0 text-2xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd
        className="min-w-0 flex-1 truncate text-right font-mono text-meta text-ink-1"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function EditableRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-2xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="shrink-0">{children}</dd>
    </div>
  );
}
