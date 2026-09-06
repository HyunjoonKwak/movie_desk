import { framesToMs, msToFrames } from "@movie-desk/core";

export const parsePrecisionNumber = (text: string): number | null => {
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

export interface PrecisionStep {
  step?: number | undefined;
  shift?: boolean | undefined;
  alt?: boolean | undefined;
  fps?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

/** Time stepping is integral frames, including Alt; numeric Alt is one tenth. */
export const stepPrecisionValue = (
  value: number,
  direction: number,
  options: PrecisionStep = {},
): number => {
  const {
    step = 1,
    shift = false,
    alt = false,
    fps,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
  } = options;
  const factor = shift ? 10 : alt && !fps ? 0.1 : 1;
  if (fps) {
    const frame = msToFrames(value, fps) + Math.round(direction * factor);
    const first = Math.ceil((min * fps) / 1000 - 1e-9) || 0;
    const last = Math.floor((max * fps) / 1000 + 1e-9);
    if (first > last) return value;
    return framesToMs(Math.min(last, Math.max(first, frame)), fps);
  }
  return Math.min(max, Math.max(min, Number((value + direction * step * factor).toFixed(10))));
};
