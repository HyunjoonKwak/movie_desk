import type { MediaAsset } from "@movie-desk/core";

// Marking in/out in the source viewer edits the asset's use range — the
// same range the card's strip editor sets and every placement honours.

export const MIN_RANGE_MS = 200;

export interface UseRange {
  readonly inMs: number;
  readonly outMs: number;
}

type RangeSource = Pick<MediaAsset, "durationMs" | "useInMs" | "useOutMs">;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

// `undefined` means "use the whole file", which is how the asset stores it.
const normalise = (asset: RangeSource, inMs: number, outMs: number): UseRange | undefined =>
  inMs <= 0 && outMs >= asset.durationMs ? undefined : { inMs, outMs };

export const markIn = (asset: RangeSource, atMs: number): UseRange | undefined => {
  const duration = asset.durationMs;
  const inMs = clamp(Math.round(atMs), 0, Math.max(0, duration - MIN_RANGE_MS));
  const outMs = Math.max(asset.useOutMs ?? duration, Math.min(duration, inMs + MIN_RANGE_MS));
  return normalise(asset, inMs, outMs);
};

export const markOut = (asset: RangeSource, atMs: number): UseRange | undefined => {
  const duration = asset.durationMs;
  const outMs = clamp(Math.round(atMs), Math.min(duration, MIN_RANGE_MS), duration);
  const inMs = Math.min(asset.useInMs ?? 0, Math.max(0, outMs - MIN_RANGE_MS));
  return normalise(asset, inMs, outMs);
};
