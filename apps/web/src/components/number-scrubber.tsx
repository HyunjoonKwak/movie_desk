"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  value: number;
  onChange: (v: number) => void;
  /** Called once when a drag-scrub gesture ends (e.g. to commit history). */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  /** Value delta per dragged pixel. Shift multiplies ×10, Alt divides ÷10. */
  step?: number;
  /**
   * When true, drags preview locally and fire onChange once on release —
   * use for history-recording actions so a drag is a single undo step.
   */
  commitOnRelease?: boolean;
  format?: ((v: number) => string) | undefined;
  className?: string;
}

const clamp = (v: number, min?: number, max?: number): number =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, v));

// FCP-style numeric field: drag horizontally to scrub the value, double-click
// (or Enter) to type an exact number. Keyboard arrows step by `step`.
export function NumberScrubber({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  commitOnRelease = false,
  format,
  className,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Local value shown while dragging in commitOnRelease mode.
  const [preview, setPreview] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag state lives in refs — scrubbing shouldn't re-render per event.
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft.replace(",", "."));
    if (Number.isFinite(parsed)) {
      const v = clamp(parsed, min, max);
      onChange(v);
      onCommit?.(v);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitDraft();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        className={cn(
          "w-16 rounded bg-white/10 px-1 text-right font-mono text-meta text-ink-1 outline-none",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      title="Drag to adjust · double-click to type"
      onPointerDown={(e) => {
        // Left button only; ignore so double-click still works naturally.
        if (e.button !== 0) return;
        drag.current = { startX: e.clientX, startValue: value, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < 3) return; // dead zone before scrubbing
        d.moved = true;
        const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const v = clamp(d.startValue + dx * step * factor, min, max);
        if (commitOnRelease) setPreview(v);
        else onChange(v);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (!d?.moved) return;
        if (commitOnRelease && preview !== null) {
          onChange(preview);
          onCommit?.(preview);
          setPreview(null);
        } else {
          onCommit?.(value);
        }
      }}
      onDoubleClick={() => {
        setDraft(String(Number.parseFloat(value.toFixed(4))));
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setDraft(String(Number.parseFloat(value.toFixed(4))));
          setEditing(true);
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          const dir = e.key === "ArrowUp" ? 1 : -1;
          const factor = e.shiftKey ? 10 : 1;
          const v = clamp(value + dir * step * factor, min, max);
          onChange(v);
          onCommit?.(v);
        }
      }}
      className={cn(
        "cursor-ew-resize select-none rounded px-1 font-mono text-meta text-ink-1",
        "hover:bg-white/10 focus:bg-white/10 focus:outline-none",
        className,
      )}
    >
      {format ? format(preview ?? value) : (preview ?? value).toFixed(2)}
    </button>
  );
}
