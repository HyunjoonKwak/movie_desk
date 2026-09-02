"use client";

import { Diamond, Gauge, Snowflake } from "lucide-react";
import type { Clip, ID } from "@movie-desk/core";
import { hasSpeedRamp, isMediaClip } from "@movie-desk/core";
import { useProjectStore, selectPlayhead } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clipId: ID;
  clip: Clip;
}

const PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];

export function SpeedSection({ clipId, clip }: Props) {
  const setClipSpeed = useProjectStore((s) => s.setClipSpeed);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const clearKeyframeTrack = useProjectStore((s) => s.clearKeyframeTrack);
  const toggleFreeze = useProjectStore((s) => s.toggleFreezeAtPlayhead);
  const playhead = useProjectStore(selectPlayhead);
  const t = useT();

  const frozen = isMediaClip(clip) && clip.freeze !== undefined;

  const ramp = hasSpeedRamp(clip);
  const relMs = Math.max(0, playhead - clip.start);
  const speedTrack = clip.keyframes.find((k) => k.target === "speed");
  const keyHere = !!speedTrack?.keyframes.some((k) => Math.abs(k.at - relMs) < 33);

  const toggleKey = () => {
    if (keyHere) removeKeyframe(clipId, "speed", relMs);
    else addKeyframe(clipId, "speed", relMs, clip.speed);
  };

  // Lays down a speed keyframe curve across the whole clip. Existing speed
  // keys are cleared first so presets stay predictable.
  const applyRamp = (points: readonly (readonly [number, number])[]) => {
    clearKeyframeTrack(clipId, "speed");
    const dur = Math.max(1, clip.duration);
    for (const [frac, rate] of points) {
      addKeyframe(clipId, "speed", Math.round(frac * dur), rate);
    }
  };

  return (
    <InspectorSection
      title={t("speed.title")}
      icon={<Gauge className="size-3" />}
      headerExtra={
        <button
          type="button"
          onClick={toggleKey}
          title={t("speed.keyHint")}
          className={keyHere ? "text-accent" : ramp ? "text-amber-400" : "text-ink-3 hover:text-ink-1"}
        >
          <Diamond className="size-3" fill={keyHere ? "currentColor" : "none"} />
        </button>
      }
    >
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span>{t("speed.constant")}</span>
        <span className="font-mono text-ink-1">{clip.speed.toFixed(2)}x</span>
      </div>
      <input
        type="range"
        min={0.1}
        max={4}
        step={0.05}
        value={clip.speed}
        onChange={(e) => setClipSpeed(clipId, Number(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setClipSpeed(clipId, s)}
            className={`rounded px-1.5 py-0.5 text-3xs ${
              Math.abs(clip.speed - s) < 0.001
                ? "bg-accent text-accent-fg"
                : "bg-panel-2 text-ink-3 hover:text-ink-1"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
      <div className="pt-1">
        <div className="mb-1 text-3xs uppercase tracking-wide text-ink-3">{t("speed.ramp")}</div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => applyRamp([[0, 0.4], [1, 2]])}
            className="rounded bg-panel-2 px-1.5 py-0.5 text-3xs text-ink-3 hover:text-ink-1"
          >
            {t("speed.rampUp")}
          </button>
          <button
            type="button"
            onClick={() => applyRamp([[0, 2], [1, 0.4]])}
            className="rounded bg-panel-2 px-1.5 py-0.5 text-3xs text-ink-3 hover:text-ink-1"
          >
            {t("speed.rampDown")}
          </button>
          <button
            type="button"
            onClick={() => applyRamp([[0, 1], [0.5, 0.25], [1, 1]])}
            className="rounded bg-panel-2 px-1.5 py-0.5 text-3xs text-ink-3 hover:text-ink-1"
          >
            {t("speed.rampDip")}
          </button>
          {ramp && (
            <button
              type="button"
              onClick={() => clearKeyframeTrack(clipId, "speed")}
              className="rounded bg-panel-2 px-1.5 py-0.5 text-3xs text-ink-3 hover:text-red-400"
            >
              {t("speed.rampClear")}
            </button>
          )}
        </div>
      </div>
      {ramp && (
        <p className="text-3xs text-amber-400">{t("speed.rampActive")}</p>
      )}

      {isMediaClip(clip) && (
        <button
          type="button"
          onClick={() => toggleFreeze(clipId)}
          className={`flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1 text-2xs ${
            frozen
              ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
              : "border-white/5 bg-panel-2 text-ink-3 hover:border-accent hover:text-accent"
          }`}
        >
          <Snowflake className="size-3" />
          {frozen ? t("speed.unfreeze") : t("speed.freeze")}
        </button>
      )}
    </InspectorSection>
  );
}
