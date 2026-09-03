import { describe, expect, it } from "vitest";
import { PRESETS, estimateExportSizeMb } from "../presets";

describe("share export presets", () => {
  it("provides clear family, YouTube, and TV/tablet targets", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(["family-720p", "youtube-1080p", "youtube-4k", "tv-tablet-4k"]),
    );
  });

  it("uses broadly compatible MP4, H.264, and AAC for the sharing targets", () => {
    for (const id of ["family-720p", "youtube-1080p", "youtube-4k", "tv-tablet-4k"]) {
      const preset = PRESETS.find((candidate) => candidate.id === id);
      expect(preset).toBeDefined();
      if (!preset) continue;
      expect(preset).toMatchObject({ container: "mp4", videoCodec: "h264", audioCodec: "aac" });
      expect(preset.width % 2).toBe(0);
      expect(preset.height % 2).toBe(0);
    }
  });

  it("gives a useful upper estimate for message-size planning", () => {
    const family = PRESETS.find((preset) => preset.id === "family-720p");
    expect(family).toBeDefined();
    if (!family) return;
    expect(estimateExportSizeMb(family, 60_000)).toBeCloseTo(20.1, 1);
    expect(estimateExportSizeMb(family, 0)).toBe(0);
  });
});
