"use client";

import { useRef, useState } from "react";
import { useT } from "@/i18n/use-t";
import { usePrecisionGesture } from "./use-precision-gesture";

/** Retains the familiar slider; a gesture/keyboard session commits once. */
export function PrecisionSlider({
  value,
  min,
  max,
  step,
  label,
  onChange,
  onPreview,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (value: number) => void;
  onPreview: (value: number) => void;
}) {
  const t = useT();
  const gesture = usePrecisionGesture(onPreview, label, value);
  const [draft, setDraft] = useState<number | null>(null);
  const aborted = useRef(false);
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);
  const clear = () => {
    pending.current = null;
    setDraft(null);
  };
  const commit = () => {
    if (aborted.current) {
      clear();
      return;
    }
    const next = pending.current;
    clear();
    if (!gesture.finish() && next !== null && next !== value) onChange(next);
  };
  return (
    <input
      type="range"
      disabled={min === max}
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      aria-label={t("precision.slider", { label })}
      aria-valuetext={String(draft ?? value)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        aborted.current = false;
      }}
      onChange={(e) => {
        if (aborted.current) {
          e.currentTarget.value = String(value);
          return;
        }
        pending.current = Number(e.target.value);
        setDraft(pending.current);
        gesture.preview(pending.current);
      }}
      onPointerUp={(e) => {
        if (aborted.current) e.currentTarget.value = String(value);
        commit();
        dragging.current = false;
        aborted.current = false;
      }}
      onLostPointerCapture={() => {
        if (!dragging.current) return;
        dragging.current = false;
        aborted.current = false;
        gesture.finish(true);
        clear();
      }}
      onBlur={commit}
      onPointerCancel={() => {
        dragging.current = false;
        aborted.current = false;
        gesture.finish(true);
        clear();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          aborted.current = dragging.current;
          gesture.finish(true);
          clear();
        }
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
