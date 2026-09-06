import { describe, expect, it } from "vitest";
import {
  addClip,
  createEmptyProject,
  findClip,
  newId,
  type MediaClip,
  type ID,
  durationForSourceSpan,
  sourceOffsetForRamp,
} from "@movie-desk/core";
import { useProjectStore } from "../project-store";

const setup = (fps = 30, speed = 1) => {
  const p = { ...createEmptyProject(), framerate: fps };
  const clip: MediaClip = {
    id: newId(),
    kind: "media",
    assetId: newId(),
    start: 1000,
    duration: 4000,
    trimIn: 0,
    trimOut: 4000,
    speed,
    effects: [],
    keyframes: [],
  };
  useProjectStore.getState().loadProject(addClip(p, p.timeline.tracks[0]!.id, clip));
  return clip;
};
const current = (id: ID) => findClip(useProjectStore.getState().project.timeline, id)!;

describe("precision edit commands", () => {
  it("source trim preserves start, recalculates duration at speed and undoes once", () => {
    const clip = setup(30, 2);
    useProjectStore.getState().setSourceTrim(clip.id, "in", 1000);
    expect(current(clip.id)).toMatchObject({
      start: 1000,
      trimIn: 1000,
      trimOut: 4000,
      duration: 1500,
    });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(current(clip.id)).toEqual(clip);
  });
  it("rejects crossing, nonfinite and out-of-source trims without history", () => {
    const clip = setup();
    for (const ms of [0, -1, 5000, Number.NaN, Number.POSITIVE_INFINITY])
      useProjectStore.getState().setSourceTrim(clip.id, "out", ms);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
  it("records exact transform input as one reversible edit", () => {
    const clip = setup();
    useProjectStore.getState().commitTransform(clip.id, { x: 0.125, rotation: 0.1 });
    expect(current(clip.id).transform).toMatchObject({ x: 0.125, rotation: 0.1 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(current(clip.id)).toEqual(clip);
  });
  it.each([23.976, 29.97])("snaps source trim and duration at %s fps", (fps) => {
    const clip = setup(fps);
    useProjectStore.getState().setSourceTrim(clip.id, "out", 1234);
    const next = current(clip.id) as MediaClip;
    expect((next.trimOut * fps) / 1000).toBeCloseTo(Math.round((1234 * fps) / 1000));
    expect((next.duration * fps) / 1000).toBeCloseTo(Math.round((next.duration * fps) / 1000));
  });
  it("inverts ramp source offsets including its constant tail", () => {
    const clip = {
      ...setup(),
      keyframes: [
        {
          target: "speed",
          keyframes: [
            { at: 0, value: 0.5, easing: "linear" as const },
            { at: 503, value: 2, easing: "linear" as const },
          ],
        },
      ],
    };
    for (const time of [0, 3, 250, 503, 510, 3000])
      expect(durationForSourceSpan(clip, sourceOffsetForRamp(clip, time))).toBeCloseTo(time, 6);
  });
});
