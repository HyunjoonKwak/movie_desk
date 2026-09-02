import type { KeyframeTrack, Ms } from "@movie-desk/core";
import type { AssetAnalysis } from "./types";

// P6 — 9:16 auto-reframe (AutoFlip-style, simplified for the family case).
// The compositor's `fit: "fill"` gives a centre cover-crop for free; this
// module only decides the horizontal camera path on top of it:
//   stationary — faces stay near one spot → single static x offset
//   tracking   — face centre drifts      → smoothed x keyframes
// Sources without face samples stay centre-cropped (scenery default).
// A 16:9 → 9:16 cover crop shows ~31.6% of the source width, so the visible
// window can pan within roughly ±0.34 of NDC before hitting the source edge.

const MAX_PAN = 0.3; // conservative clamp inside the theoretical ±0.34
const TRACK_THRESHOLD = 0.08; // face-centre stddev that flips to tracking mode

export interface ReframePlan {
  readonly transform?: { x: number; y: number; scale: number; rotation: number; opacity: number };
  readonly keyframes: readonly KeyframeTrack[];
}

// Face centre x (0..1, 0.5 = centred) → NDC x offset for the crop window.
// Shifting the CONTENT by -(cx-0.5) brings an off-centre face into view.
const toOffset = (cx: number): number =>
  Math.max(-MAX_PAN, Math.min(MAX_PAN, -(cx - 0.5) * 2 * 0.55));

export const planReframe = (
  analysis: AssetAnalysis | undefined,
  srcStartMs: Ms,
  durationMs: Ms,
): ReframePlan => {
  const windowSamples = (analysis?.samples ?? []).filter(
    (s) => s.atMs >= srcStartMs && s.atMs <= srcStartMs + durationMs && s.faceCx !== undefined,
  );
  if (windowSamples.length === 0) return { keyframes: [] }; // centre crop

  const cxs = windowSamples.map((s) => s.faceCx!);
  const mean = cxs.reduce((a, b) => a + b, 0) / cxs.length;
  const std = Math.sqrt(cxs.reduce((a, c) => a + (c - mean) ** 2, 0) / cxs.length);

  if (std < TRACK_THRESHOLD || windowSamples.length < 3) {
    // stationary — one offset keeps the subject in frame
    const x = toOffset(mean);
    if (Math.abs(x) < 0.02) return { keyframes: [] };
    return { transform: { x, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  }

  // tracking — smooth the per-sample offsets with a 3-tap moving average and
  // emit clip-relative keyframes on transform.x.
  const smoothed = cxs.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(cxs.length - 1, i + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += cxs[k]!;
    return sum / (hi - lo + 1);
  });
  const track: KeyframeTrack = {
    target: "transform.x",
    keyframes: smoothed.map((cx, i) => ({
      at: Math.max(0, windowSamples[i]!.atMs - srcStartMs),
      value: toOffset(cx),
      easing: "ease-in-out" as const,
    })),
  };
  return { keyframes: [track] };
};
