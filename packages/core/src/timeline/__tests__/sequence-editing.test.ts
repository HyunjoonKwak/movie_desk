import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../model/factory";
import type { SequenceClip } from "../../model/clip";
import { newId } from "../../utils/id";
import { addClip, rollEdit, slideClip, slipClip } from "../mutate";
import { splitClipAt } from "../split";
import { insertClipAt, overwriteClipAt } from "../three-point";

const fixture = () => {
  const root = createEmptyProject({ framerate: 25 });
  const child = { ...createEmptyProject().timeline, duration: 10000 };
  const project = { ...root, timelines: [...root.timelines, child] };
  const clip: SequenceClip = {
    id: newId(), kind: "sequence", timelineId: child.id,
    start: 0, duration: 2000, trimIn: 500, trimOut: 2500,
    speed: 1, effects: [], keyframes: [],
  };
  return { clip, project: addClip(project, root.timeline.tracks[0]!.id, clip) };
};

describe("sequence source-window editing", () => {
  it("razors and inserts with continuous child source offsets", () => {
    const { project, clip } = fixture();
    const split = splitClipAt(project, clip.id, 1000).timeline.tracks[0]!.clips;
    expect(split.map((c) => [c.start, c.duration, "trimIn" in c && c.trimIn])).toEqual([
      [0, 1000, 500], [1000, 1000, 1500],
    ]);
    const inserted = insertClipAt(project, project.timeline.tracks[0]!.id, { ...clip, id: newId(), duration: 400 }, 1000);
    expect(inserted.timeline.tracks[0]!.clips.map((c) => [c.start, "trimIn" in c && c.trimIn])).toEqual([
      [0, 500], [1000, 500], [1400, 1500],
    ]);
    expect(inserted.timelines.find((t) => t.id === inserted.rootTimelineId)).toBe(inserted.timeline);
  });

  it("overwrites the middle or head without replaying the child beginning", () => {
    const { project, clip } = fixture();
    for (const at of [0, 800]) {
      const after = overwriteClipAt(project, project.timeline.tracks[0]!.id, { ...clip, id: newId(), duration: 400 }, at);
      const tail = after.timeline.tracks[0]!.clips.at(-1)!;
      expect(tail.start).toBe(at + 400);
      expect("trimIn" in tail && tail.trimIn).toBe(500 + at + 400);
    }
  });

  it("rolls and slides sequence neighbours, clamping the source at zero", () => {
    const { project, clip } = fixture();
    const next = { ...clip, id: newId(), start: 2000 };
    const p = addClip(project, project.timeline.tracks[0]!.id, next);
    const rolled = rollEdit(p, clip.id, -800).timeline.tracks[0]!.clips;
    expect(rolled.map((c) => [c.start, c.duration, "trimIn" in c && c.trimIn])).toEqual([
      [0, 1500, 500], [1500, 2500, 0],
    ]);
    const last = { ...clip, id: newId(), start: 4000 };
    const three = addClip(p, p.timeline.tracks[0]!.id, last);
    const slid = slideClip(three, next.id, 200).timeline.tracks[0]!.clips;
    expect(slid.map((c) => [c.start, c.duration, "trimIn" in c && c.trimIn])).toEqual([
      [0, 2200, 500], [2200, 2000, 500], [4200, 1800, 700],
    ]);
  });

  it("slips within the child source bounds without moving placement", () => {
    const { project, clip } = fixture();
    const after = slipClip(project, clip.id, 10000, 3000).timeline.tracks[0]!.clips[0]!;
    expect(after).toMatchObject({ start: 0, duration: 2000, trimIn: 1000, trimOut: 3000 });
    const before = slipClip(project, clip.id, -10000, 3000).timeline.tracks[0]!.clips[0]!;
    expect(before).toMatchObject({ start: 0, duration: 2000, trimIn: 0, trimOut: 2000 });
  });
});
