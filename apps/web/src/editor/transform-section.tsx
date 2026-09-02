"use client";

import { Diamond } from "lucide-react";
import type { Clip, ID, BlendMode } from "@movie-desk/core";
import { clipTransform } from "@movie-desk/core";
import { useProjectStore, selectPlayhead } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { NumberScrubber } from "@/components/number-scrubber";
import { useT } from "@/i18n/use-t";
import { BLEND_GROUPS } from "./blend-groups";

interface Props {
  clipId: ID;
  clip: Clip;
}

// Picture-in-picture corner placements (scaled-down inset) plus a centered
// full-size reset. x/y are centered fractions; +y is up in the compositor.
const PIP = 0.32;
const PIP_PRESETS = [
  { key: "pipTL", glyph: "◰", x: -PIP, y: PIP, scale: 0.35 },
  { key: "pipTR", glyph: "◳", x: PIP, y: PIP, scale: 0.35 },
  { key: "pipBL", glyph: "◱", x: -PIP, y: -PIP, scale: 0.35 },
  { key: "pipBR", glyph: "◲", x: PIP, y: -PIP, scale: 0.35 },
] as const;

export function TransformSection({ clipId, clip }: Props) {
  const setTransform = useProjectStore((s) => s.setTransform);
  const setBlendMode = useProjectStore((s) => s.setBlendMode);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const playhead = useProjectStore(selectPlayhead);
  const t = useT();
  const tf = clipTransform(clip);

  // Clip-relative time used as the keyframe position.
  const relMs = Math.max(0, playhead - clip.start);

  const hasKeyframeAt = (target: string): boolean => {
    const track = clip.keyframes.find((k) => k.target === target);
    return !!track?.keyframes.some((k) => Math.abs(k.at - relMs) < 33);
  };
  const hasAnyKeyframe = (target: string): boolean =>
    !!clip.keyframes.find((k) => k.target === target)?.keyframes.length;

  const toggleKeyframe = (target: string, value: number) => {
    if (hasKeyframeAt(target)) removeKeyframe(clipId, target, relMs);
    else addKeyframe(clipId, target, relMs, value);
  };

  return (
    <InspectorSection title={t("transform.title")}>
      <NumRow
        label={t("transform.x")}
        min={-1}
        max={1}
        step={0.01}
        value={tf.x}
        onChange={(v) => setTransform(clipId, { x: v })}
        keyed={hasAnyKeyframe("transform.x")}
        keyedHere={hasKeyframeAt("transform.x")}
        onToggleKey={() => toggleKeyframe("transform.x", tf.x)}
      />
      <NumRow
        label={t("transform.y")}
        min={-1}
        max={1}
        step={0.01}
        value={tf.y}
        onChange={(v) => setTransform(clipId, { y: v })}
        keyed={hasAnyKeyframe("transform.y")}
        keyedHere={hasKeyframeAt("transform.y")}
        onToggleKey={() => toggleKeyframe("transform.y", tf.y)}
      />
      <NumRow
        label={t("transform.scale")}
        min={0.1}
        max={4}
        step={0.01}
        value={tf.scale}
        onChange={(v) => setTransform(clipId, { scale: v })}
        keyed={hasAnyKeyframe("transform.scale")}
        keyedHere={hasKeyframeAt("transform.scale")}
        onToggleKey={() => toggleKeyframe("transform.scale", tf.scale)}
      />
      <NumRow
        label={t("transform.rotation")}
        min={-180}
        max={180}
        step={1}
        value={(tf.rotation * 180) / Math.PI}
        onChange={(deg) => setTransform(clipId, { rotation: (deg * Math.PI) / 180 })}
        format={(v) => `${v.toFixed(0)}°`}
        keyed={hasAnyKeyframe("transform.rotation")}
        keyedHere={hasKeyframeAt("transform.rotation")}
        onToggleKey={() => toggleKeyframe("transform.rotation", tf.rotation)}
      />
      <NumRow
        label={t("transform.opacity")}
        min={0}
        max={1}
        step={0.01}
        value={tf.opacity}
        onChange={(v) => setTransform(clipId, { opacity: v })}
        keyed={hasAnyKeyframe("transform.opacity")}
        keyedHere={hasKeyframeAt("transform.opacity")}
        onToggleKey={() => toggleKeyframe("transform.opacity", tf.opacity)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-ink-3">{t("transform.blend")}</span>
        <select
          value={clip.blendMode ?? "normal"}
          onChange={(e) => setBlendMode(clipId, e.target.value as BlendMode)}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          {BLEND_GROUPS.map((g) => (
            <optgroup key={g.labelKey} label={t(g.labelKey)} className="bg-panel-2">
              {g.modes.map((m) => (
                <option key={m} value={m} className="bg-panel-2">
                  {t(`blend.${m}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-1 text-3xs uppercase tracking-wide text-ink-3">{t("transform.pip")}</div>
        <div className="grid grid-cols-4 gap-1">
          {PIP_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setTransform(clipId, { x: p.x, y: p.y, scale: p.scale })}
              title={t(`transform.${p.key}`)}
              className="rounded bg-panel-2 px-1 py-1 text-3xs text-ink-3 hover:bg-white/10 hover:text-ink-1"
            >
              {p.glyph}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          setTransform(clipId, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })
        }
        className="w-full rounded border border-white/5 bg-panel-2 px-2 py-1 text-2xs text-ink-3 hover:border-accent hover:text-accent"
      >
        {t("transform.reset")}
      </button>
    </InspectorSection>
  );
}

function NumRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
  keyed,
  keyedHere,
  onToggleKey,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  keyed: boolean;
  keyedHere: boolean;
  onToggleKey: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleKey}
            title="Toggle keyframe at playhead"
            className={
              keyedHere
                ? "text-accent"
                : keyed
                  ? "text-amber-400"
                  : "text-ink-3 hover:text-ink-1"
            }
          >
            <Diamond className="size-3" fill={keyedHere ? "currentColor" : "none"} />
          </button>
          {label}
        </span>
        <NumberScrubber
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          format={format}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
    </div>
  );
}
