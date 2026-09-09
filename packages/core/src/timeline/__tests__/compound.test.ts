import { expect, it } from "vitest";
import { createEmptyProject } from "../../model/factory";
import { type Clip, clipEnd, type MediaClip, type SequenceClip } from "../../model/clip";
import { replaceTimeline } from "../../model/project-timelines";
import type { Project } from "../../model/project";
import { type ID, newId } from "../../utils/id";
import { createCompound, unpackCompound } from "../compound";

const media = (start: number, duration: number, trimIn = 0): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId: "asset" as ID,
  start,
  duration,
  trimIn,
  trimOut: trimIn + duration,
  speed: 1,
  effects: [],
  keyframes: [],
});

const withClips = (rows: readonly (readonly Clip[])[]): Project => {
  const base = createEmptyProject();
  const template = base.timeline.tracks[0]!;
  const tracks = rows.map((clips, i) => ({
    ...template,
    id: (i ? newId() : template.id) as ID,
    clips,
  }));
  return replaceTimeline(base, { ...base.timeline, tracks });
};

const allClips = (p: Project) => p.timeline.tracks.flatMap((t) => t.clips);

it("moves the selection into a child and leaves one sequence clip in its place", () => {
  const a = media(1000, 500);
  const b = media(2000, 500);
  const project = withClips([[a, b]]);

  const { project: next, refusal } = createCompound(project, [a.id, b.id], "Compound 1");
  expect(refusal).toBeUndefined();
  expect(next.timelines).toHaveLength(2);

  const placed = allClips(next);
  expect(placed).toHaveLength(1);
  const sequence = placed[0] as SequenceClip;
  expect(sequence.kind).toBe("sequence");
  expect(sequence.label).toBe("Compound 1");
  // Spans the selection, gap included, so the visible shape does not change.
  expect(sequence.start).toBe(1000);
  expect(sequence.duration).toBe(1500);

  const child = next.timelines.find((t) => t.id === sequence.timelineId)!;
  const inside = child.tracks.flatMap((t) => t.clips);
  expect(inside.map((c) => c.start)).toEqual([0, 1000]);
});

it("keeps the gap between selected clips instead of closing it", () => {
  const a = media(0, 200);
  const b = media(5000, 200);
  const project = withClips([[a, b]]);
  const { project: next } = createCompound(project, [a.id, b.id]);
  const sequence = allClips(next)[0] as SequenceClip;
  expect(sequence.duration).toBe(5200);
});

it("round-trips an untrimmed compound back to the original timing", () => {
  const a = media(1000, 500);
  const b = media(2000, 500);
  const project = withClips([[a, b]]);
  const { project: packed } = createCompound(project, [a.id, b.id]);
  const sequence = allClips(packed)[0] as SequenceClip;

  const { project: back, refusal, trimmedAway } = unpackCompound(packed, sequence.id);
  expect(refusal).toBeUndefined();
  expect(trimmedAway).toBeUndefined();
  const restored = allClips(back).sort((x, y) => x.start - y.start);
  expect(restored.map((c) => [c.start, c.duration])).toEqual([
    [1000, 500],
    [2000, 500],
  ]);
  // Nothing else references the child, so it does not linger.
  expect(back.timelines).toHaveLength(1);
});

it("drops what the parent had trimmed away and reports how many clips it cut", () => {
  const a = media(0, 1000);
  const b = media(1000, 1000);
  const project = withClips([[a, b]]);
  const { project: packed } = createCompound(project, [a.id, b.id]);
  const sequence = allClips(packed)[0] as SequenceClip;
  // Show only the first half: the second clip is entirely outside the window.
  const trimmed: SequenceClip = { ...sequence, duration: 1000, trimOut: 1000 };
  const staged = replaceTimeline(packed, {
    ...packed.timeline,
    tracks: packed.timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === sequence.id ? trimmed : c)),
    })),
  });

  const { project: back, trimmedAway } = unpackCompound(staged, sequence.id);
  expect(trimmedAway).toBe(1);
  const restored = allClips(back);
  expect(restored).toHaveLength(1);
  expect(clipEnd(restored[0]!)).toBe(1000);
});

it("advances into the source when the parent trimmed the head", () => {
  const a = media(0, 1000);
  const project = withClips([[a]]);
  const { project: packed } = createCompound(project, [a.id]);
  const sequence = allClips(packed)[0] as SequenceClip;
  const trimmed: SequenceClip = { ...sequence, start: 400, trimIn: 400, duration: 600, trimOut: 1000 };
  const staged = replaceTimeline(packed, {
    ...packed.timeline,
    tracks: packed.timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === sequence.id ? trimmed : c)),
    })),
  });

  const { project: back } = unpackCompound(staged, sequence.id);
  const restored = allClips(back)[0] as MediaClip;
  expect(restored.start).toBe(400);
  expect(restored.duration).toBe(600);
  // The frame under the playhead must not change: skip 400ms into the source.
  expect(restored.trimIn).toBe(400);
});

it("refuses a speed-ramped compound rather than changing what plays", () => {
  const a = media(0, 1000);
  const project = withClips([[a]]);
  const { project: packed } = createCompound(project, [a.id]);
  const sequence = allClips(packed)[0] as SequenceClip;
  const ramped: SequenceClip = {
    ...sequence,
    keyframes: [
      {
        target: "speed",
        keyframes: [
          { at: 0, value: 1, easing: "linear" },
          { at: 1000, value: 2, easing: "linear" },
        ],
      },
    ],
  };
  const staged = replaceTimeline(packed, {
    ...packed.timeline,
    tracks: packed.timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === sequence.id ? ramped : c)),
    })),
  });

  const { project: back, refusal } = unpackCompound(staged, sequence.id);
  expect(refusal).toBe("speed-ramped");
  expect(back).toBe(staged);
});

it("keeps a child that another clip still shows", () => {
  const a = media(0, 1000);
  const project = withClips([[a]]);
  const { project: packed } = createCompound(project, [a.id]);
  const sequence = allClips(packed)[0] as SequenceClip;
  const second: SequenceClip = { ...sequence, id: newId(), start: 4000 };
  const staged = replaceTimeline(packed, {
    ...packed.timeline,
    tracks: packed.timeline.tracks.map((t, i) => (i ? t : { ...t, clips: [...t.clips, second] })),
  });

  const { project: back } = unpackCompound(staged, sequence.id);
  expect(back.timelines).toHaveLength(2);
  expect(allClips(back).some((c) => c.id === second.id)).toBe(true);
});

it("refuses an empty selection and a clip that is not a sequence", () => {
  const a = media(0, 1000);
  const project = withClips([[a]]);
  expect(createCompound(project, []).refusal).toBe("needs-selection");
  expect(unpackCompound(project, a.id).refusal).toBe("not-a-sequence");
});
