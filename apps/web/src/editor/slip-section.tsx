"use client";

import { MoveHorizontal } from "lucide-react";
import type { MediaClip, SpatialFit } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clip: MediaClip;
}

const FITS: readonly SpatialFit[] = ["stretch", "fill", "fit"];

// Slip the source window of a media clip without moving it on the timeline.
// The slider's range is the slack between the clip's source span and the
// asset's full duration.
export function SlipSection({ clip }: Props) {
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
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span>{t("slip.sourceIn")}</span>
        <span className="font-mono text-ink-1">{Math.round(clip.trimIn)} ms</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={10}
        value={Math.min(clip.trimIn, max)}
        disabled={max <= 0}
        onChange={(e) => slip(clip.id, Number(e.target.value) - clip.trimIn)}
        className="w-full accent-accent disabled:opacity-40"
      />
      {max <= 0 && <p className="text-3xs text-ink-3">{t("slip.noSlack")}</p>}
    </InspectorSection>
  );
}
