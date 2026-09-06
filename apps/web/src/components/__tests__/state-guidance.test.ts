import { useProjectStore } from "@/stores/project-store";
import { createEmptyProject } from "@movie-desk/core";
import { describe, expect, it, vi } from "vitest";
import { ANALYSIS_HINT_KEYS, analysisGuidance } from "@/autoedit/state-guidance";
import { candidateWindowMs } from "@/autoedit/candidate-window";
import { MODE_PRESETS } from "@/autoedit/modes";
import { mediaGuidance } from "@/media/state-guidance";
import { timelineGuidance } from "@/timeline/state-guidance";
import { en } from "@/i18n/messages.en";
import { ko } from "@/i18n/messages.ko";

describe("panel guidance", () => {
  it.each([
    [0, 0, "empty"],
    [3, 0, "filtered"],
    [3, 2, null],
  ] as const)("library %i/%i", (total, shown, state) => {
    expect(mediaGuidance(total, shown)).toBe(state);
  });
  it("counts only live selections and tracks locks without a clip array", () => {
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
    [true, 1, 0, "running"],
    [false, 1, 0, "before"],
    [false, 0, 2, "analysisFailed"],
  ] as const)(
    "skips candidate work: running=%s done=%i failed=%i",
    (running, doneCount, failedCount, state) => {
      // Even pinned assets could produce candidates after all analysis failed: failure takes priority.
      const candidates = vi.fn(() => 1000);
      for (let tick = 0; tick < 1000; tick++) {
        expect(analysisGuidance({ total: 2, running, doneCount, failedCount }, candidates)).toBe(
          state,
        );
      }
      expect(candidates).not.toHaveBeenCalled();
    },
  );
  it.each([
    [0, "noCandidates"],
    [1, null],
    [null, null],
  ] as const)("settled candidate count %s", (count, state) => {
    expect(
      analysisGuidance({ total: 2, running: false, doneCount: 1, failedCount: 1 }, () => count),
    ).toBe(state);
  });
  it("has real bilingual keys for every guidance state", () => {
    const keys = [
      "state.media.empty",
      "state.media.filtered",
      "state.timeline.empty",
      "state.timeline.unselected",
      "state.timeline.selected",
      ...Object.values(ANALYSIS_HINT_KEYS),
    ];
    for (const key of keys) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(Object.hasOwn(ko, key), key).toBe(true);
    }
  });
  it("uses the generation mode and BPM window including the minimum", () => {
    for (const mode of Object.keys(MODE_PRESETS) as (keyof typeof MODE_PRESETS)[]) {
      const preset = MODE_PRESETS[mode];
      expect(candidateWindowMs(mode)).toBe(
        Math.max(1200, Math.round(preset.beatsMid * preset.fallbackCutMs)),
      );
      expect(candidateWindowMs(mode, 60)).toBe(Math.max(1200, Math.round(preset.beatsMid * 1000)));
      expect(candidateWindowMs(mode, 10000)).toBe(1200);
    }
  });
});
