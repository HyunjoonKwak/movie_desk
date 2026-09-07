import { expect, it } from "vitest";
import { type Clip, type SequenceClip, isMediaClip, isSequenceClip, newId } from "../../index";

it("identifies sequence references separately from media clips", () => {
  const sequence: SequenceClip = {
    id: newId(),
    kind: "sequence",
    timelineId: newId(),
    start: 50,
    duration: 1000,
    speed: 1,
    trimIn: 20,
    trimOut: 1020,
    volume: 0.5,
    effects: [],
    keyframes: [],
  };
  const clip: Clip = sequence;
  expect(isSequenceClip(clip)).toBe(true);
  expect(isMediaClip(clip)).toBe(false);
  expect(isSequenceClip({ ...sequence, kind: "adjustment" })).toBe(false);
});
