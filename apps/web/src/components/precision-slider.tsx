"use client";

import { useRef, useState } from "react";

/** Retains the familiar slider; a gesture/keyboard session commits once. */
export function PrecisionSlider({
  value,
  min,
  max,
  step,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const clear = () => {
    pending.current = null;
    setDraft(null);
  };
  const commit = () => {
    const next = pending.current;
    clear();
    if (next !== null && next !== value) onChange(next);
  };
  return (
    <input
      type="range"
      disabled={min === max}
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      aria-label={label}
      aria-valuetext={String(draft ?? value)}
      onChange={(e) => {
        pending.current = Number(e.target.value);
        setDraft(pending.current);
      }}
      onPointerUp={commit}
      onBlur={commit}
      onPointerCancel={clear}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") clear();
        if (e.key === "Enter") commit();
      }}
      onKeyUp={(e) => {
        if (e.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(e.key))
          commit();
      }}
      className="mt-1 w-full accent-accent disabled:opacity-40"
    />
  );
}
