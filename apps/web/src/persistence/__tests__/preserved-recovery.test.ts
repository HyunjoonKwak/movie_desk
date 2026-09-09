import { createEmptyProject, newId, type ID, type MediaClip, type Project } from "@movie-desk/core";
import { expect, it } from "vitest";
import { preservedClips } from "../preserved-clips";
import { discardPreservedClip, restorePreservedClip } from "../preserved-recovery";

const media = (): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId: newId(),
  start: 0,
  duration: 1000,
  trimIn: 0,
  trimOut: 1000,
  speed: 1,
  effects: [],
  keyframes: [],
});

const withPreserved = (clips: readonly MediaClip[]): Project => {
  const base = createEmptyProject();
  return {
    ...base,
    preservedClips: clips.map((clip) => ({ timelineId: base.rootTimelineId, clip })),
  } as Project;
};

it("puts a preserved clip back on a track and stops preserving it", () => {
  const clip = media();
  const project = withPreserved([clip]);
  const trackId = project.timeline.tracks[0]!.id;

  const { project: next, refusal } = restorePreservedClip(project, clip.id, trackId);
  expect(refusal).toBeUndefined();
  expect(next.timeline.tracks[0]!.clips.map((c) => c.id)).toContain(clip.id);
  expect(preservedClips(next)).toHaveLength(0);
});

it("keeps the other preserved clips when one is restored", () => {
  const a = media();
  const b = media();
  const project = withPreserved([a, b]);
  const trackId = project.timeline.tracks[0]!.id;

  const { project: next } = restorePreservedClip(project, a.id, trackId);
  expect(preservedClips(next).map((e) => e.clip.id)).toEqual([b.id]);
});

it("removes the field entirely once nothing is preserved", () => {
  const clip = media();
  const project = withPreserved([clip]);
  const next = discardPreservedClip(project, clip.id);
  expect(preservedClips(next)).toHaveLength(0);
  expect("preservedClips" in next).toBe(false);
});

it("ignores an id that is not preserved instead of throwing", () => {
  const project = withPreserved([media()]);
  const { project: next } = restorePreservedClip(project, newId() as ID, project.timeline.tracks[0]!.id);
  expect(next).toBe(project);
});
