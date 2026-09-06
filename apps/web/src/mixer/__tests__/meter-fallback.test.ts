import { type ID, createEmptyProject } from "@movie-desk/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  project: {} as ReturnType<typeof createEmptyProject>,
  playing: true,
  live: false,
  waveforms: {},
}));
vi.mock("@/stores/project-store", () => ({
  useProjectStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
    getState: () => state,
  }),
}));
vi.mock("@/stores/playback-store", () => ({
  usePlaybackStore: (select: (s: typeof state) => unknown) => select(state),
}));
vi.mock("@/stores/preview-store", () => ({
  usePreviewStore: (select: (s: typeof state) => unknown) => select(state),
  requestWaveforms() {},
  retainWaveform() {},
}));
vi.mock("../meter-store", () => ({
  useMeterStore: (select: (s: unknown) => unknown) =>
    select({ live: state.live, levels: { master: { peak: 0, heldPeak: 0 } } }),
}));
vi.mock("@/i18n/use-t", () => ({ useT: () => (key: string) => key }));
import { MixerMeter } from "../mixer-meter";
it("shows a nonzero waveform estimate during playback when the worklet is unavailable", () => {
  const p = createEmptyProject();
  state.project = {
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
  };
  const markup = renderToStaticMarkup(createElement(MixerMeter, { id: "master" }));
  expect(markup).toContain('aria-label="mixer.estimated master"');
  expect(Number(markup.match(/aria-valuenow="([^"]+)"/)![1])).toBeGreaterThan(-60);
  state.project = { ...state.project, timeline: { ...state.project.timeline, playhead: 750 } };
  const moved = renderToStaticMarkup(createElement(MixerMeter, { id: "master" }));
  expect(Number(moved.match(/aria-valuenow="([^"]+)"/)![1])).toBeLessThan(
    Number(markup.match(/aria-valuenow="([^"]+)"/)![1]),
  );
  state.live = true;
  expect(renderToStaticMarkup(createElement(MixerMeter, { id: "master" }))).toContain(
    'aria-label="mixer.live master"',
  );
});
