"use client";

import { useId, useRef, useState } from "react";
import { formatTimecode, parseTimecode } from "@movie-desk/core";
import { useT } from "@/i18n/use-t";
import { usePrecisionGesture } from "./use-precision-gesture";
import { parsePrecisionNumber, stepPrecisionValue } from "./precision-input-utils";

interface Props {
  value: number;
  onChange: (value: number) => void;
  onPreview?: ((value: number) => void) | undefined;
  label: string;
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Present only for time values stored in milliseconds. */
  fps?: number | undefined;
}

/** Typing/arrows stay local; supported scrubs publish live values in one undo session. */
export function PrecisionInput({
  value,
  onChange,
  onPreview,
  label,
  unit,
  min,
  max,
  step = 1,
  fps,
}: Props) {
  const t = useT();
  const gesture = usePrecisionGesture(onPreview);
  const id = useId();
  const display = (v: number) => (fps ? formatTimecode(v, fps) : String(Number(v.toFixed(6))));
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const draftRef = useRef<string | null>(null);
  const drag = useRef<{ x: number; value: number; next: number; moved: boolean } | null>(null);
  const update = (text: string | null) => {
    draftRef.current = text;
    setDraft(text);
    setInvalid(false);
  };
  const parse = (text: string) => (fps ? parseTimecode(text, fps) : parsePrecisionNumber(text));
  const commit = (onBlur = false) => {
    if (draftRef.current === null) return;
    const next = parse(draftRef.current);
    if (
      next === null ||
      next < (min ?? Number.NEGATIVE_INFINITY) - 1e-9 ||
      next > (max ?? Number.POSITIVE_INFINITY) + 1e-9
    ) {
      if (onBlur) update(null);
      else setInvalid(true);
      return;
    }
    update(null);
    if (Math.abs(next - value) > 1e-9) onChange(next);
  };
  const cancel = () => {
    drag.current = null;
    gesture.finish(true);
    update(null);
  };
  const hint = fps ? t("precision.timeHint", { fps }) : t("precision.numberHint");
  return (
    <span className="inline-flex max-w-full flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          tabIndex={-1}
          data-precision-scrub
          aria-label={t("precision.scrub", { label })}
          title={hint}
          className="touch-none cursor-ew-resize rounded px-1 text-ink-3 hover:bg-white/10"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key !== "Tab") e.preventDefault();
            if (e.key === "Escape") {
              cancel();
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const entered = draftRef.current === null ? value : parse(draftRef.current);
            const start =
              entered !== null &&
              entered >= (min ?? Number.NEGATIVE_INFINITY) &&
              entered <= (max ?? Number.POSITIVE_INFINITY)
                ? entered
                : value;
            commit(true);
            e.currentTarget.focus();
            drag.current = { x: e.clientX, value: start, next: start, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || (Math.abs(e.clientX - d.x) < 3 && !d.moved)) return;
            d.moved = true;
            d.next = stepPrecisionValue(d.value, Math.round(e.clientX - d.x), {
              step,
              fps,
              min,
              max,
              shift: e.shiftKey,
              alt: e.altKey,
            });
            update(display(d.next));
            gesture.preview(d.next);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
            update(null);
            if (!gesture.finish() && d?.moved && Math.abs(d.next - value) > 1e-9) onChange(d.next);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={() => {
            if (drag.current) cancel();
          }}
        >
          ↔
        </button>
        <input
          type="text"
          role="spinbutton"
          inputMode={fps ? "text" : "decimal"}
          aria-label={label}
          aria-valuenow={draft === null ? value : (parse(draft) ?? value)}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={`${draft ?? display(value)}${unit ? ` ${unit}` : ""}`}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ""}`}
          title={hint}
          value={draft ?? display(value)}
          onChange={(e) => update(e.target.value)}
          onBlur={() => commit(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commit();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const current = draftRef.current === null ? value : parse(draftRef.current);
              if (current === null) {
                setInvalid(true);
                return;
              }
              update(
                display(
                  stepPrecisionValue(current, e.key === "ArrowUp" ? 1 : -1, {
                    step,
                    fps,
                    min,
                    max,
                    shift: e.shiftKey,
                    alt: e.altKey,
                  }),
                ),
              );
            }
          }}
          className={`${fps ? "w-28" : "w-16"} min-w-0 rounded border border-line bg-panel-2 px-1 py-0.5 text-right font-mono text-meta text-ink-1 focus:border-accent focus:outline-none`}
        />
        {unit && <span className="text-3xs text-ink-3">{unit}</span>}
      </span>
      <span id={`${id}-hint`} className="sr-only">
        {hint}
      </span>
      {invalid && (
        <span id={`${id}-error`} role="alert" className="max-w-48 text-3xs text-red-400">
          {t("precision.invalid")}
          {min !== undefined || max !== undefined
            ? ` (${min === undefined ? "−∞" : display(min)} – ${max === undefined ? "∞" : display(max)})`
            : ""}
        </span>
      )}
    </span>
  );
}
