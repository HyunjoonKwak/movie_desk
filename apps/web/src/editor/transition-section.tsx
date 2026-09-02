"use client";

import type { Clip, ID, Transition, TransitionType } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clipId: ID;
  clip: Clip;
}

const TYPES: readonly TransitionType[] = [
  "fade",
  "cross-dissolve",
  "dip-to-black",
  "dip-to-white",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "zoom-in",
  "zoom-out",
  "spin",
  "wipe",
];

export function TransitionSection({ clipId, clip }: Props) {
  const setIn = useProjectStore((s) => s.setTransitionInFor);
  const setOut = useProjectStore((s) => s.setTransitionOutFor);
  const t = useT();

  return (
    <InspectorSection title={t("trans.title")}>
      <TransitionRow
        label={t("trans.in")}
        value={clip.transitionIn}
        onChange={(v) => setIn(clipId, v)}
      />
      <TransitionRow
        label={t("trans.out")}
        value={clip.transitionOut}
        onChange={(v) => setOut(clipId, v)}
      />
    </InspectorSection>
  );
}

function TransitionRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Transition | undefined;
  onChange: (v: Transition | undefined) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <div className="text-2xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="flex items-center gap-1">
        <select
          value={value?.type ?? ""}
          onChange={(e) => {
            const type = e.target.value as TransitionType | "";
            if (!type) onChange(undefined);
            else onChange({ type, duration: value?.duration ?? 500 });
          }}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none focus:bg-white/10"
        >
          <option value="">{t("trans.none")}</option>
          {TYPES.map((type) => (
            <option key={type} value={type} className="bg-panel-2">
              {type}
            </option>
          ))}
        </select>
        {value && (
          <input
            type="number"
            min={50}
            max={5000}
            step={50}
            value={value.duration}
            onChange={(e) =>
              onChange({ ...value, duration: Math.max(50, Number(e.target.value)) })
            }
            className="w-16 rounded bg-white/5 px-1 py-1 text-right text-xs text-ink-1 outline-none"
          />
        )}
        {value && <span className="text-3xs text-ink-3">ms</span>}
      </div>
    </div>
  );
}
