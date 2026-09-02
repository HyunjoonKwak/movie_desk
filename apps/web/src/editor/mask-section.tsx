"use client";

import type { Clip, ID, ClipMask } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clipId: ID;
  clip: Clip;
}

const DEFAULT_MASK: ClipMask = {
  shape: "rect",
  x: 0.2,
  y: 0.2,
  w: 0.6,
  h: 0.6,
  feather: 0.02,
  inverted: false,
};

export function MaskSection({ clipId, clip }: Props) {
  const setMask = useProjectStore((s) => s.setMask);
  const t = useT();
  const mask = clip.mask;

  return (
    <InspectorSection
      title={t("mask.title")}
      headerExtra={
        <label className="flex items-center gap-1 text-2xs text-ink-3">
          <input
            type="checkbox"
            checked={!!mask}
            onChange={(e) => setMask(clipId, e.target.checked ? DEFAULT_MASK : undefined)}
            className="accent-accent"
          />
          {t("mask.enable")}
        </label>
      }
    >
      {mask && (
        <>
          <div className="flex gap-1">
            {(["rect", "ellipse"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMask(clipId, { ...mask, shape: s })}
                className={`flex-1 rounded px-2 py-1 text-2xs ${
                  mask.shape === s ? "bg-accent text-accent-fg" : "bg-panel-2 text-ink-3 hover:text-ink-1"
                }`}
              >
                {t(`mask.${s}`)}
              </button>
            ))}
          </div>
          <Slider label="X" v={mask.x} onChange={(x) => setMask(clipId, { ...mask, x })} />
          <Slider label="Y" v={mask.y} onChange={(y) => setMask(clipId, { ...mask, y })} />
          <Slider label="W" v={mask.w} onChange={(w) => setMask(clipId, { ...mask, w })} />
          <Slider label="H" v={mask.h} onChange={(h) => setMask(clipId, { ...mask, h })} />
          <Slider
            label={t("mask.feather")}
            v={mask.feather}
            max={0.5}
            onChange={(feather) => setMask(clipId, { ...mask, feather })}
          />
          <label className="flex items-center gap-2 text-2xs text-ink-3">
            <input
              type="checkbox"
              checked={mask.inverted}
              onChange={(e) => setMask(clipId, { ...mask, inverted: e.target.checked })}
              className="accent-accent"
            />
            {t("mask.invert")}
          </label>
        </>
      )}
    </InspectorSection>
  );
}

function Slider({
  label,
  v,
  max = 1,
  onChange,
}: {
  label: string;
  v: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span>{label}</span>
        <span className="font-mono text-ink-1">{v.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
    </div>
  );
}
