import { describe, expect, it } from "vitest";
import type { MediaClip, SequenceClip } from "../../model/clip";
import { createEmptyProject } from "../../model/factory";
import type { Project } from "../../model/project";
import { replaceTimeline } from "../../model/project-timelines";
import { type ID, newId } from "../../utils/id";
import { createCut, deleteCut, duplicateCut, isCut, listCuts, renameCut, switchCut } from "../cuts";

const media = (start: number, duration: number): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId: "asset" as ID,
  start,
  duration,
  trimIn: 0,
  trimOut: duration,
  speed: 1,
  effects: [],
  keyframes: [],
});

const withClip = (project: Project): Project =>
  replaceTimeline(project, {
    ...project.timeline,
    tracks: project.timeline.tracks.map((t, i) =>
      i === 0 ? { ...t, clips: [media(0, 1000)] } : t,
    ),
    duration: 1000,
  });

describe("cuts", () => {
  it("a fresh project has exactly one cut: its root", () => {
    const project = createEmptyProject();
    expect(listCuts(project).map((c) => c.id)).toEqual([project.rootTimelineId]);
    expect(isCut(project, project.rootTimelineId)).toBe(true);
  });

  it("creates an empty cut, makes it the root, and keeps the old root as a cut", () => {
    const base = withClip(createEmptyProject());
    const { project, cutId } = createCut(base, "짧은 버전");
    expect(project.rootTimelineId).toBe(cutId);
    expect(project.timeline.id).toBe(cutId);
    expect(project.timeline.name).toBe("짧은 버전");
    expect(project.timeline.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
    expect(project.timeline.tracks.every((t) => t.clips.length === 0)).toBe(true);
    expect(project.timeline.zoom).toBe(base.timeline.zoom);
    expect(listCuts(project).map((c) => c.id)).toEqual([base.rootTimelineId, cutId]);
    // The original cut is untouched and still holds its clip.
    expect(
      project.timelines.find((t) => t.id === base.rootTimelineId)?.tracks[0]?.clips,
    ).toHaveLength(1);
    expect(project.timelines.find((t) => t.id === base.rootTimelineId)?.role).toBe("cut");
    expect(project.mediaLibrary).toBe(base.mediaLibrary);
  });

  it("switches between cuts without touching either one", () => {
    const base = withClip(createEmptyProject());
    const { project: two, cutId } = createCut(base);
    const back = switchCut(two, base.rootTimelineId);
    expect(back.timeline.id).toBe(base.rootTimelineId);
    expect(back.timeline.tracks[0]?.clips).toHaveLength(1);
    expect(back.timelines.find((t) => t.id === cutId)).toBe(two.timeline);
    expect(switchCut(back, back.rootTimelineId)).toBe(back);
    expect(() => switchCut(back, "nope" as ID)).toThrow();
  });

  it("refuses to switch to a compound child: only cuts can be the root", () => {
    const base = withClip(createEmptyProject());
    const child = { ...createEmptyProject().timeline, id: newId() };
    const sequence: SequenceClip = {
      id: newId(),
      kind: "sequence",
      timelineId: child.id,
      start: 1000,
      duration: 500,
      trimIn: 0,
      trimOut: 500,
      speed: 1,
      effects: [],
      keyframes: [],
    };
    const withChild: Project = replaceTimeline(
      { ...base, timelines: [...base.timelines, child] },
      {
        ...base.timeline,
        tracks: base.timeline.tracks.map((t, i) =>
          i === 0 ? { ...t, clips: [...t.clips, sequence] } : t,
        ),
      },
    );
    expect(isCut(withChild, child.id)).toBe(false);
    expect(listCuts(withChild).map((c) => c.id)).toEqual([base.rootTimelineId]);
    expect(() => switchCut(withChild, child.id)).toThrow();
  });

  it("renames a cut", () => {
    const base = createEmptyProject();
    expect(renameCut(base, base.rootTimelineId, "  본편  ").timeline.name).toBe("본편");
    expect(renameCut(base, base.rootTimelineId, "   ").timeline.name).toBeUndefined();
  });

  it("duplicates a cut with fresh track and clip ids and switches to the copy", () => {
    const base = withClip(createEmptyProject());
    const { project, cutId } = duplicateCut(base, base.rootTimelineId, "복사본");
    expect(project.rootTimelineId).toBe(cutId);
    expect(cutId).not.toBe(base.rootTimelineId);
    const copy = project.timeline;
    expect(copy.name).toBe("복사본");
    expect(copy.tracks.map((t) => t.id)).not.toContain(base.timeline.tracks[0]?.id);
    expect(copy.tracks[0]?.clips).toHaveLength(1);
    expect(copy.tracks[0]?.clips[0]?.id).not.toBe(base.timeline.tracks[0]?.clips[0]?.id);
    expect(copy.duration).toBe(1000);
    expect(listCuts(project)).toHaveLength(2);
  });

  it("deletes a cut, moves the root off it, and never deletes the last one", () => {
    const base = withClip(createEmptyProject());
    const { project: two, cutId } = createCut(base, "B");
    expect(two.rootTimelineId).toBe(cutId);
    const after = deleteCut(two, cutId);
    expect(after.rootTimelineId).toBe(base.rootTimelineId);
    expect(after.timelines.some((t) => t.id === cutId)).toBe(false);
    expect(listCuts(after)).toHaveLength(1);
    expect(() => deleteCut(after, base.rootTimelineId)).toThrow();
    // Deleting a cut that is not the root keeps the root where it is.
    const { project: three, cutId: c3 } = createCut(after, "C");
    const kept = deleteCut(three, base.rootTimelineId);
    expect(kept.rootTimelineId).toBe(c3);
    expect(listCuts(kept).map((c) => c.id)).toEqual([c3]);
  });
});
