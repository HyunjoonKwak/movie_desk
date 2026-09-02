"use client";

import { Diamond, Volume2 } from "lucide-react";
import type { MediaClip } from "@movie-desk/core";
import { useProjectStore, selectPlayhead } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clip: MediaClip;
}

// Volume control for media clips. A "volume" keyframe track (multiplier over
// clip time) overrides the static value during the mix, enabling manual
// fades and ducking.
export function AudioSection({ clip }: Props) {
  const setVolume = useProjectStore((s) => s.setClipVolume);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const playhead = useProjectStore(selectPlayhead);
  const t = useT();

  const vol = clip.volume ?? 1;
  const relMs = Math.max(0, playhead - clip.start);
  const track = clip.keyframes.find((k) => k.target === "volume");
  const keyed = !!track?.keyframes.length;
  const keyHere = !!track?.keyframes.some((k) => Math.abs(k.at - relMs) < 33);

  const toggleKey = () => {
    if (keyHere) removeKeyframe(clip.id, "volume", relMs);
    else addKeyframe(clip.id, "volume", relMs, vol);
  };

  return (
    <InspectorSection
      title={t("audio.title")}
      icon={<Volume2 className="size-3" />}
      headerExtra={
        <button
          type="button"
          onClick={toggleKey}
          title={t("audio.keyHint")}
          className={keyHere ? "text-accent" : keyed ? "text-amber-400" : "text-ink-3 hover:text-ink-1"}
        >
          <Diamond className="size-3" fill={keyHere ? "currentColor" : "none"} />
        </button>
      }
    >
      <div className="flex items-center justify-between text-2xs text-ink-3">
        <span>{t("audio.volume")}</span>
        <span className="font-mono text-ink-1">{Math.round(vol * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        value={vol}
        onChange={(e) => setVolume(clip.id, Number(e.target.value))}
        className="w-full accent-accent"
      />
    </InspectorSection>
  );
}
