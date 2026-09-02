import { describe, expect, it } from "vitest";
import { recommendLength, recommendMode } from "../modes";

describe("auto-edit recommendations", () => {
  it("returns stable reason codes instead of locale-specific copy", () => {
    expect(
      recommendMode({ smileyRatio: 0.2, faceRatio: 0.1, goldenRatio: 0.5, usableMs: 60_000 }),
    ).toEqual({ mode: "highlight", reason: "people" });
    expect(
      recommendMode({ smileyRatio: 0, faceRatio: 0.1, goldenRatio: 0.4, usableMs: 60_000 }),
    ).toEqual({ mode: "scenic", reason: "scenic" });
    expect(
      recommendMode({ smileyRatio: 0, faceRatio: 0.1, goldenRatio: 0, usableMs: 13 * 60_000 }),
    ).toEqual({ mode: "record", reason: "long" });
    expect(
      recommendMode({ smileyRatio: 0, faceRatio: 0.1, goldenRatio: 0, usableMs: 5 * 60_000 }),
    ).toEqual({ mode: "highlight", reason: "balanced" });
  });

  it("keeps suggested duration inside the selected mode's range", () => {
    expect(recommendLength(10_000, "highlight")).toBe(60_000);
    expect(recommendLength(60 * 60_000, "highlight")).toBe(180_000);
    expect(recommendLength(20 * 60_000, "record")).toBe(180_000);
  });
});
