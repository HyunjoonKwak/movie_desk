import { type ID, createEmptyProject, type Project } from "@movie-desk/core";
import { expect, it } from "vitest";
import { estimatedLevels, meterAssets } from "../estimated-levels";

const estimateProject = (): Project => {
  const p = createEmptyProject();
  return {
    ...p,
    mediaLibrary: [
      {
        id: "a" as ID,
        kind: "audio",
        name: "A",
        mime: "audio/wav",
        opfsPath: "fixture",
        importedAt: 0,
        durationMs: 1000,
        waveformPeaks: [0.5, 0.25],
      },
    ],
    timeline: {
      ...p.timeline,
      tracks: [
        {
          ...p.timeline.tracks[0]!,
          audio: { busId: "b", gainDb: -6 },
          clips: [
            {
              id: "c" as ID,
              kind: "media",
              assetId: "a" as ID,
              start: 0,
              duration: 1000,
              trimIn: 0,
              trimOut: 1000,
              speed: 1,
              effects: [],
              keyframes: [],
            },
          ],
        },
      ],
    },
    audio: { buses: [{ id: "b", name: "Bus", gainDb: -6 }], master: { gainDb: -6 } },
  };
};
it("shares asset maps across playhead changes and all strip estimates per frame", () => {
  const p = estimateProject();
  const waveforms = {};
  const first = estimatedLevels(p, waveforms);
  expect(estimatedLevels({ ...p }, waveforms)).toBe(first);
  expect(estimatedLevels({ ...p, id: "other" as ID }, waveforms)).not.toBe(first);
  expect(first[`track:${p.timeline.tracks[0]!.id}`]).toBeCloseTo(0.5 * 10 ** (-6 / 20));
  expect(first["bus:b"]).toBeCloseTo(0.5 * 10 ** (-12 / 20));
  expect(first.master).toBeCloseTo(0.5 * 10 ** (-18 / 20));
  const moved = { ...p, timeline: { ...p.timeline, playhead: 750 } };
  expect(meterAssets(moved.mediaLibrary)).toBe(meterAssets(p.mediaLibrary));
  expect(estimatedLevels(moved, waveforms).master).toBeCloseTo(first.master! / 2);
  const muted = {
    ...moved,
    audio: { ...p.audio!, buses: [{ ...p.audio!.buses[0]!, muted: true }] },
  };
  expect(estimatedLevels(muted, waveforms).master).toBe(0);
  const previewOnly = {
    ...moved,
    mediaLibrary: moved.mediaLibrary.map(({ waveformPeaks: _peaks, ...asset }) => asset),
  };
  expect(meterAssets(previewOnly.mediaLibrary)).not.toBe(meterAssets(moved.mediaLibrary));
  const previewFirst = estimatedLevels(previewOnly, { a: [0.2] });
  expect(estimatedLevels(previewOnly, { a: [0.4] }).master).toBeCloseTo(previewFirst.master! * 2);
});
