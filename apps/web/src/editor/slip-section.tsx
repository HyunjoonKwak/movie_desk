"use client";

import { MoveHorizontal } from "lucide-react";
import type { MediaClip, SpatialFit } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { PrecisionInput } from "@/components/precision-input";
import { PrecisionSlider } from "@/components/precision-slider";
import { useT } from "@/i18n/use-t";

interface Props {
  clip: MediaClip;
}

const FITS: readonly SpatialFit[] = ["stretch", "fill", "fit"];

// Slip the source window of a media clip without moving it on the timeline.
// The slider's range is the slack between the clip's source span and the
// asset's full duration.
export function SlipSection({ clip }: Props) {
  const fps = useProjectStore((s) => s.project.framerate);
  const setSourceTrim = useProjectStore((s) => s.setSourceTrim);
  const previewSlip = useProjectStore((s) => s.previewSlipClipTo);
  const slip = useProjectStore((s) => s.slipClipBy);
  const setFit = useProjectStore((s) => s.setClipFit);
  const asset = useProjectStore((s) => s.project.mediaLibrary.find((a) => a.id === clip.assetId));
  const t = useT();

  const span = clip.trimOut - clip.trimIn;
  const max = Math.max(0, (asset?.durationMs ?? span) - span);

  return (
    <InspectorSection title={t("slip.title")} icon={<MoveHorizontal className="size-3" />}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-ink-3">{t("fit.title")}</span>
        <select
          value={clip.fit ?? "stretch"}
          onChange={(e) => setFit(clip.id, e.target.value as SpatialFit)}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          {FITS.map((f) => (
            <option key={f} value={f} className="bg-panel-2">
              {t(`fit.${f}`)}
            </option>
          ))}
        </select>
      </div>
      {asset?.kind !== "image" && (
        <>
          <div className="flex items-center justify-between text-2xs text-ink-3">
            <span>{t("slip.sourceIn")}</span>
            <PrecisionInput
              key={clip.id}
              label={t("slip.sourceIn")}
              fps={fps}
              value={clip.trimIn}
              min={0}
              max={clip.trimOut - 1000 / fps}
              onChange={(v) => setSourceTrim(clip.id, "in", v)}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-2xs text-ink-3">
            <span>{t("precision.sourceOut")}</span>
            <PrecisionInput
              key={clip.id}
              label={t("precision.sourceOut")}
              fps={fps}
              value={clip.trimOut}
              min={clip.trimIn + 1000 / fps}
              max={asset?.durationMs ?? clip.trimOut}
              onChange={(v) => setSourceTrim(clip.id, "out", v)}
            />
          </div>
          <p className="text-3xs text-ink-3">{t("precision.trimHint")}</p>
          <PrecisionSlider
            key={clip.id}
            onPreview={(v) => previewSlip(clip.id, v)}
            label={t("slip.title")}
            min={0}
            max={max}
            step={10}
            value={Math.min(clip.trimIn, max)}
            onChange={(v) => slip(clip.id, v - clip.trimIn)}
          />
          {max <= 0 && <p className="text-3xs text-ink-3">{t("slip.noSlack")}</p>}
        </>
      )}
    </InspectorSection>
  );
}
