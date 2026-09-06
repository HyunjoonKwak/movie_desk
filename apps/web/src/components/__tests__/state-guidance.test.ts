import { useProjectStore } from "@/stores/project-store";
import { createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { analysisGuidance, mediaGuidance, timelineGuidance } from "../state-guidance";

describe("panel guidance", () => {
  it.each([
    [0, 0, "empty"],
    [3, 0, "filtered"],
    [3, 2, null],
  ] as const)("library %i/%i", (total, shown, state) => {
    expect(mediaGuidance(total, shown)).toBe(state);
  });
  it("counts only live selections and reports locks independently of emptiness", () => {
    useProjectStore.getState().loadProject(createEmptyProject());
    const initial = useProjectStore.getState().project.timeline.tracks;
    expect(timelineGuidance(initial, new Set(["stale"]))).toMatchObject({
      state: "empty",
      count: 0,
    });
    useProjectStore.getState().addTextClipAtPlayhead("Title");
    const tracks = useProjectStore.getState().project.timeline.tracks;
    const clip = tracks.flatMap((track) => track.clips)[0]!;
    expect(timelineGuidance(tracks, new Set(["stale"])).state).toBe("unselected");
    expect(timelineGuidance(tracks, new Set([clip.id, "stale"]))).toMatchObject({
      state: "selected",
      count: 1,
    });
    expect(
      timelineGuidance(
        tracks.map((track) => ({ ...track, locked: true })),
        new Set(),
      ).locked,
    ).toBe(true);
  });
  it.each([
    [0, false, false, 0, "empty"],
    [2, true, false, 0, "running"],
    [2, false, false, 0, "before"],
    [2, false, true, 0, "noCandidates"],
    [2, false, true, 1, null],
  ] as const)(
    "analysis %i running=%s settled=%s candidates=%i",
    (total, running, settled, candidates, state) => {
      expect(analysisGuidance(total, running, settled, candidates)).toBe(state);
    },
  );
});
