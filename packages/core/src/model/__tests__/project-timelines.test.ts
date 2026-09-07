import { describe, expect, it } from "vitest";
import {
  addClip,
  addMarker,
  createEmptyProject,
  editMixer,
  emptyHistory,
  findTimeline,
  hydrateProjectTimelines,
  newId,
  redo,
  replaceTimeline,
  runCommand,
  setPlayhead,
  setZoom,
  splitClipAt,
  syncRootTimeline,
  toLegacyProject,
  undo,
  updateTrack,
  type MediaClip,
  type Project,
} from "../../index";
import { recompute, replaceTrack } from "../../timeline/mutate-internal";

const assertRoot = (project: Project) => {
  expect(project.timeline.id).toBe(project.rootTimelineId);
  expect(findTimeline(project, project.rootTimelineId)).toBe(project.timeline);
};
const clip = (): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId: newId(),
  start: 0,
  duration: 2000,
  trimIn: 0,
  trimOut: 2000,
  speed: 1,
  effects: [],
  keyframes: [],
});

describe("Phase 0 timeline model", () => {
  it("seeds one root and honors timeline/root overrides", () => {
    const base = createEmptyProject();
    assertRoot(base);
    expect(base.timelines).toEqual([base.timeline]);
    const alternate = { ...base.timeline, id: newId(), zoom: 0.2 };
    const overridden = createEmptyProject({
      timelines: [base.timeline, alternate],
      rootTimelineId: alternate.id,
    });
    assertRoot(overridden);
    expect(overridden.timeline).toBe(alternate);
    assertRoot(createEmptyProject({ timeline: alternate }));
    expect(() => createEmptyProject({ rootTimelineId: newId() })).toThrow();
    expect(findTimeline(base, newId())).toBeUndefined();
    const patched = createEmptyProject({ ...base, timeline: { ...base.timeline, playhead: 33 } });
    assertRoot(patched);
    expect(patched.timeline.playhead).toBe(33);
    expect(() => createEmptyProject({ timelines: [base.timeline, base.timeline] })).toThrow();
  });

  it("keeps untouched timelines by identity through both common gateways", () => {
    const root = createEmptyProject();
    const child = { ...root.timeline, id: newId(), duration: 99 };
    const project = createEmptyProject({
      timelines: [root.timeline, child],
      rootTimelineId: root.rootTimelineId,
    });
    const track = { ...child.tracks[0]!, clips: [clip()] };
    const replaced = replaceTrack(project, track, child.id);
    assertRoot(replaced);
    expect(replaced.timeline).toBe(project.timeline);
    expect(findTimeline(replaced, child.id)?.tracks[0]).toBe(track);
    const next = recompute(replaced, findTimeline(replaced, child.id)!);
    assertRoot(next);
    expect(next.timeline).toBe(project.timeline);
    expect(findTimeline(next, child.id)?.duration).toBe(2000);
    expect(child.duration).toBe(99);
    const rootEdit = updateTrack(next, next.timeline.tracks[0]!.id, (t) => ({ ...t, muted: true }));
    assertRoot(rootEdit);
    expect(findTimeline(rootEdit, child.id)).toBe(findTimeline(next, child.id));
    expect(() => replaceTrack(project, track, newId())).toThrow();
    expect(() => replaceTimeline(project, { ...child, id: newId() })).toThrow();
    expect(() => toLegacyProject(next)).toThrow();
  });

  it("preserves alias identity through edits, transient view, mixer and undo/redo", () => {
    let project = createEmptyProject();
    const media = clip();
    project = addClip(project, project.timeline.tracks[0]!.id, media);
    assertRoot(project);
    const timestamp = project.updatedAt;
    project = setZoom(setPlayhead(project, 123), 0.25);
    assertRoot(project);
    expect(project.updatedAt).toBe(timestamp);
    expect(project.timeline.playhead).toBe(123);
    expect(project.timeline.duration).toBe(2000);
    project = addMarker(project, { at: 100, label: "cue", color: "#fff" });
    assertRoot(project);
    project = splitClipAt(project, media.id, 1000);
    assertRoot(project);
    expect(project.timeline.tracks[0]?.clips).toHaveLength(2);
    project = editMixer(project, { kind: "bus-add", id: "dialog", name: "Dialog" });
    project = editMixer(project, {
      kind: "track",
      id: project.timeline.tracks[0]!.id,
      patch: { gainDb: -6, busId: "dialog" },
    });
    assertRoot(project);
    const result = runCommand(project, emptyHistory, {
      label: "Remove bus",
      apply: (p) => editMixer(p, { kind: "bus-delete", id: "dialog" }),
    });
    assertRoot(result.project);
    expect(result.project.timeline.tracks[0]?.audio?.busId).toBeUndefined();
    const undone = undo(result.project, result.history);
    assertRoot(undone.project);
    expect(undone.project).toBe(project);
    const redone = redo(undone.project, undone.history);
    assertRoot(redone.project);
    expect(redone.project).toBe(result.project);
  });

  it("normalizes legacy root writes from custom commands before recording history", () => {
    const project = createEmptyProject();
    const result = runCommand(project, emptyHistory, {
      label: "Legacy custom edit",
      apply: (p) => ({ ...p, timeline: { ...p.timeline, playhead: 80 } }),
    });
    assertRoot(result.project);
    assertRoot(result.applied.after);
    expect(result.project.timeline.playhead).toBe(80);
    expect(undo(result.project, result.history).project).toBe(project);
    expect(runCommand(project, emptyHistory, { label: "noop", apply: (p) => p }).project).toBe(
      project,
    );
  });

  it("round-trips legacy JSON exactly and derives stable runtime identities", () => {
    const legacy = {
      id: newId(),
      name: "Legacy",
      createdAt: 1,
      updatedAt: 2,
      framerate: 24,
      resolution: { w: 1920, h: 1080 },
      mediaLibrary: [],
      timeline: { tracks: [], playhead: 12, zoom: 0.08, duration: 777, markers: [] },
      audio: { buses: [], master: { gainDb: -3 } },
    };
    const project = hydrateProjectTimelines(legacy);
    assertRoot(project);
    expect(toLegacyProject(project)).toEqual(legacy);
    const reloaded = hydrateProjectTimelines(JSON.parse(JSON.stringify(toLegacyProject(project))));
    assertRoot(reloaded);
    expect(reloaded.rootTimelineId).toBe(project.rootTimelineId);
    expect(reloaded).toEqual(project);
    expect(project.timeline.duration).toBe(777); // no recompute on load
    expect(() => hydrateProjectTimelines({ ...legacy, timelines: [] } as typeof legacy)).toThrow();
    expect(() =>
      hydrateProjectTimelines({ ...legacy, rootTimelineId: "missing" } as typeof legacy),
    ).toThrow();
    expect(() => syncRootTimeline({ ...project, rootTimelineId: newId() })).toThrow();
  });
});
