import { describe, expect, it } from "vitest";
import type { ID } from "@movie-desk/core";
import { planReframe } from "../reframe";
import type { AssetAnalysis, FrameSample } from "../types";

const mk = (samples: FrameSample[]): AssetAnalysis => ({
  assetId: "a" as ID,
  kind: "video",
  durationMs: 10000,
  samples,
  shakeTier: "stable",
  junk: [],
  interest: samples.map(() => 0.5),
  quality: 0.8,
});

const sample = (atMs: number, faceCx?: number): FrameSample => ({
  atMs,
  blurVar: 100,
  exposureLow: 0,
  exposureHigh: 0,
  entropy: 6,
  motion: 0.1,
  ...(faceCx !== undefined ? { faceCx, faceArea: 0.05, smile: 0 } : {}),
});

describe("planReframe (9:16)", () => {
  it("no faces → centre crop (no transform, no keyframes)", () => {
    const r = planReframe(mk([sample(0), sample(1000)]), 0, 2000);
    expect(r.keyframes).toHaveLength(0);
    expect(r.transform).toBeUndefined();
  });

  it("steady off-centre face → stationary offset pulling subject into view", () => {
    const r = planReframe(mk([sample(0, 0.75), sample(1000, 0.76), sample(2000, 0.74)]), 0, 2500);
    expect(r.keyframes).toHaveLength(0);
    expect(r.transform).toBeDefined();
    // face on the right (cx>0.5) → content shifts left (negative x)
    expect(r.transform!.x).toBeLessThan(-0.1);
    expect(r.transform!.x).toBeGreaterThanOrEqual(-0.3);
  });

  it("drifting face → tracking keyframes on transform.x, clip-relative", () => {
    const r = planReframe(
      mk([sample(2000, 0.2), sample(3000, 0.5), sample(4000, 0.8), sample(5000, 0.85)]),
      2000,
      3000,
    );
    expect(r.keyframes).toHaveLength(1);
    const kfs = r.keyframes[0]!.keyframes;
    expect(r.keyframes[0]!.target).toBe("transform.x");
    expect(kfs[0]!.at).toBe(0); // clip-relative
    // moves from face-left (positive offset) toward face-right (negative)
    expect(kfs[0]!.value).toBeGreaterThan(kfs[kfs.length - 1]!.value);
    // clamped within the safe pan range
    for (const k of kfs) expect(Math.abs(k.value)).toBeLessThanOrEqual(0.3);
  });

  it("centred face → no-op even when stationary", () => {
    const r = planReframe(mk([sample(0, 0.5), sample(1000, 0.51)]), 0, 2000);
    expect(r.transform).toBeUndefined();
    expect(r.keyframes).toHaveLength(0);
  });
});
