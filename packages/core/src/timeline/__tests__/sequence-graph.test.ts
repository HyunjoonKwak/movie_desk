import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../model/factory";
import type { Project, Timeline } from "../../model/project";
import type { SequenceClip } from "../../model/clip";
import { newId } from "../../utils/id";
import { addClip, moveClipToTrack } from "../mutate-core";
import { duplicateClip, pasteClips } from "../mutate-edit";
import { inspectProject } from "../inspect";
import { computeDuration } from "../query";
import {
  collectSequenceRefs,
  MAX_SEQUENCE_DEPTH,
  sequenceDepth,
  sequenceEditReason,
  wouldCreateCycle,
} from "../sequence-graph";

const sequence = (target: Timeline): SequenceClip => ({
  id: newId(),
  kind: "sequence",
  timelineId: target.id,
  start: 0,
  duration: 9999,
  trimIn: 0,
  trimOut: 9999,
  speed: 1,
  effects: [],
  keyframes: [],
});
const chain = (length: number, cycle = false): Project => {
  const base = createEmptyProject();
  const timelines = Array.from({ length }, () => ({ ...base.timeline, id: newId() }));
  const linked = timelines.map((t, i) => ({
    ...t,
    tracks: t.tracks.map((track, j) => ({
      ...track,
      clips: j
        ? []
        : i < length - 1
          ? [sequence(timelines[i + 1]!)]
          : cycle
            ? [sequence(timelines[0]!)]
            : [],
    })),
  }));
  return { ...base, timeline: linked[0]!, rootTimelineId: linked[0]!.id, timelines: linked };
};

describe("sequence safety", () => {
  it.each([1, 2, 3])("survives a %i-node cycle without recursion", (length) => {
    const p = chain(length, true);
    expect(sequenceDepth(p, p.rootTimelineId)).toBe(MAX_SEQUENCE_DEPTH);
    expect(computeDuration(p)).toBe(0);
    expect(inspectProject(p).filter((i) => i.code === "cyclic-sequence")).toHaveLength(length);
    expect(wouldCreateCycle(p, p.rootTimelineId, p.rootTimelineId)).toBe(true);
  });
  it("caps deeply corrupt input without overflowing the JS stack", () => {
    const p = chain(10000);
    expect(sequenceDepth(p, p.rootTimelineId)).toBe(MAX_SEQUENCE_DEPTH);
    expect(computeDuration(p)).toBe(0);
    expect(
      inspectProject(chain(MAX_SEQUENCE_DEPTH + 1)).some((i) => i.code === "depth-exceeded"),
    ).toBe(true);
  });
  it("allows eight levels and rejects an edit that would deepen an ancestor beyond eight", () => {
    const p = chain(MAX_SEQUENCE_DEPTH - 1);
    const leaf = {
      ...p.timeline,
      id: newId(),
      tracks: p.timeline.tracks.map((t) => ({ ...t, clips: [] })),
    };
    const leaf2 = { ...leaf, id: newId() };
    const next = { ...p, timelines: [...p.timelines, leaf, leaf2] };
    const parent = p.timelines.at(-1)!;
    expect(sequenceEditReason(next, [sequence(leaf)], parent.id)).toBeUndefined();
    const linked = { ...leaf, tracks: [{ ...leaf.tracks[0]!, clips: [sequence(leaf2)] }] };
    expect(
      sequenceEditReason(
        { ...next, timelines: [...p.timelines, linked, leaf2] },
        [sequence(linked)],
        parent.id,
      ),
    ).toBe("depth-exceeded");
  });
  it("identifies cross-edge cycles to already finished subtrees", () => {
    const p = chain(3, true);
    const [a, b, c] = p.timelines;
    const root = { ...a!, tracks: [{ ...a!.tracks[0]!, clips: [sequence(b!), sequence(c!)] }] };
    const middle = { ...b!, tracks: [{ ...b!.tracks[0]!, clips: [sequence(root)] }] };
    const last = { ...c!, tracks: [{ ...c!.tracks[0]!, clips: [sequence(middle)] }] };
    const next = { ...p, timeline: root, timelines: [root, middle, last] };
    expect(inspectProject(next).filter((i) => i.code === "cyclic-sequence")).toHaveLength(4);
    expect(computeDuration(next)).toBe(0);
  });
  it("keeps all four rejected edits atomic, including clipboard batches", () => {
    const p = chain(2, true);
    const clip = p.timeline.tracks[0]!.clips[0]!;
    const track = p.timeline.tracks[0]!;
    expect(addClip(p, track.id, clip)).toBe(p);
    expect(moveClipToTrack(p, clip.id, p.timeline.tracks[1]!.id)).toBe(p);
    expect(duplicateClip(p, clip.id)).toBe(p);
    expect(
      pasteClips(
        p,
        [
          { trackId: track.id, clip: { ...clip, kind: "adjustment" } },
          { trackId: track.id, clip },
        ],
        1000,
      ),
    ).toBe(p);
  });
  it("uses child duration with source trims/speed and memoizes shared children", () => {
    const p = chain(2);
    const child = p.timelines[1]!;
    const leaf = { ...sequence(child), kind: "adjustment" as const, duration: 2000 };
    const updatedChild = { ...child, tracks: [{ ...child.tracks[0]!, clips: [leaf] }] };
    const clip = { ...sequence(child), start: 100, trimIn: 500, trimOut: 4000, speed: 2 };
    const root = {
      ...p.timeline,
      tracks: [{ ...p.timeline.tracks[0]!, clips: [clip, { ...clip, id: newId(), start: 2000 }] }],
    };
    const next = { ...p, timeline: root, timelines: [root, updatedChild] };
    expect(computeDuration(next)).toBe(2750);
    expect(sequenceDepth(next, root.id)).toBe(2);
    expect(collectSequenceRefs(root)).toEqual([child.id]);
  });
  it("retains and inspects missing targets and preserved sequences without playback edges", () => {
    const p = chain(2);
    const missing = { ...p, timelines: [p.timeline] };
    expect(computeDuration(missing)).toBe(0);
    expect(inspectProject(missing).some((i) => i.code === "missing-sequence")).toBe(true);
    const base = createEmptyProject();
    const clip = sequence(base.timeline);
    const recovered = { ...base, preservedClips: [{ timelineId: base.rootTimelineId, clip }] };
    expect(collectSequenceRefs(recovered.timeline)).toEqual([]);
    expect(inspectProject(recovered).some((i) => i.code === "cyclic-sequence")).toBe(true);
    expect(addClip(recovered, base.timeline.tracks[0]!.id, clip)).toBe(recovered);
  });
});
