import { beforeEach, expect, it } from "vitest";
import { createEmptyProject, type Project, type ID, type ShapeClip, newId } from "@movie-desk/core";
import { useProjectStore } from "../project-store";
import { useEditorStore, openTimeline } from "../editor-store";
import { useTimelineUiStore } from "../timeline-ui-store";
import { usePlaybackStore } from "../playback-store";
import { useSelectionStore } from "../selection-store";
import { useRangeStore } from "../range-store";

let base: Project;
let childId: ID;
let clipId: ID;
beforeEach(() => {
  const root = createEmptyProject({ framerate: 25 });
  const clip: ShapeClip = {
    id: newId(), kind: "shape", shape: "rect", fill: "#ff0000", stroke: "#000000", strokeWidth: 0,
    start: 0, duration: 2000, speed: 1, effects: [], keyframes: [],
  };
  const child = createEmptyProject().timeline;
  const timeline = { ...child, duration: 2000, tracks: child.tracks.map((t, i) => i === 0 ? { ...t, clips: [clip] } : t) };
  base = { ...root, timelines: [...root.timelines, timeline] };
  childId = child.id;
  clipId = clip.id;
  useProjectStore.getState().loadProject(base);
});
const child = () => useProjectStore.getState().project.timelines.find((t) => t.id === childId)!;
const assertCanonical = () => {
  const project = useProjectStore.getState().project;
  expect(project.rootTimelineId).toBe(base.rootTimelineId);
  expect(project.timeline).toBe(project.timelines.find((t) => t.id === base.rootTimelineId));
  for (const entry of useProjectStore.getState().history.past) {
    expect(entry.before.timeline.id).toBe(base.rootTimelineId);
    expect(entry.after.timeline.id).toBe(base.rootTimelineId);
  }
};

it("edits children with one undo while tab switches do not enter history", () => {
  const store = useProjectStore.getState();
  openTimeline(childId);
  expect(useProjectStore.getState().project).toBe(base);
  store.splitAllAt(1000);
  expect(child().tracks[0]!.clips).toHaveLength(2);
  expect(useProjectStore.getState().project.timeline).toBe(base.timeline);
  openTimeline(base.rootTimelineId);
  openTimeline(childId);
  expect(useProjectStore.getState().history.past).toHaveLength(1);
  store.undo();
  expect(child().tracks[0]!.clips).toHaveLength(1);
  expect(useTimelineUiStore.getState().activeTimelineId).toBe(childId);
  expect(useEditorStore.getState().project.timeline.id).toBe(childId);
  store.redo();
  expect(child().tracks[0]!.clips).toHaveLength(2);
  assertCanonical();
});

it("routes drag, precision, marker, playhead, zoom and track actions to the child", () => {
  const store = useProjectStore.getState();
  openTimeline(childId);
  store.setPlayheadMs(400);
  store.setZoomLevel(0.2);
  store.beginClipDrag();
  store.dragClipTo(clipId, 500);
  store.endClipDrag();
  expect(child().tracks[0]!.clips[0]!.start).toBe(520);
  store.undo();
  expect(child().tracks[0]!.clips[0]!.start).toBe(0);
  const token = store.beginPrecisionEdit("Transform");
  store.setTransform(clipId, { x: 0.4 });
  expect(child().tracks[0]!.clips[0]!.transform?.x).toBe(0.4);
  store.endPrecisionEdit(token, true);
  expect(child().tracks[0]!.clips[0]!.transform).toBeUndefined();
  store.addNewTrack("text");
  expect(child().tracks).toHaveLength(base.timelines[1]!.tracks.length + 1);
  expect(useProjectStore.getState().project.timeline).toBe(base.timeline);
  expect(useTimelineUiStore.getState().activeTimelineId).toBe(childId);
  assertCanonical();
});

it("switching ends playback and clears timeline-local selection and range", () => {
  usePlaybackStore.getState().setPlaying(true);
  useSelectionStore.getState().select(clipId);
  useRangeStore.getState().setIn(400);
  openTimeline(childId);
  expect(usePlaybackStore.getState().playing).toBe(false);
  expect(useSelectionStore.getState().clipIds.size).toBe(0);
  expect(useRangeStore.getState().inMs).toBeNull();
  expect(useProjectStore.getState().history.past).toHaveLength(0);
  useProjectStore.getState().loadProject(createEmptyProject());
  expect(useTimelineUiStore.getState().activeTimelineId).toBeNull();
  expect(useEditorStore.getState().project).toBe(useProjectStore.getState().project);
});

it("keeps view state on precision cancellation and publishes canonical snapshots", () => {
  const store = useProjectStore.getState();
  openTimeline(childId);
  const token = store.beginPrecisionEdit("Transform");
  store.setTransform(clipId, { x: 0.4 });
  store.setPlayheadMs(720);
  store.setZoomLevel(0.3);
  store.endPrecisionEdit(token, true);
  expect(child()).toMatchObject({ playhead: 720, zoom: 0.3 });
  expect(child().tracks[0]!.clips[0]!.transform).toBeUndefined();
  expect(JSON.parse(JSON.stringify(useProjectStore.getState().project)).rootTimelineId).toBe(base.rootTimelineId);
  expect("activeTimelineId" in useProjectStore.getState().project).toBe(false);
  assertCanonical();
});

it("bounds sequence slip and explicit source trim by the child duration", () => {
  const store = useProjectStore.getState();
  const id = newId();
  store.addClipToTrack(base.timeline.tracks[0]!.id, {
    id, kind: "sequence", timelineId: childId, start: 0, duration: 1000,
    trimIn: 0, trimOut: 1000, speed: 1, effects: [], keyframes: [],
  });
  store.slipClipBy(id, 10000);
  expect(useProjectStore.getState().project.timeline.tracks[0]!.clips[0]).toMatchObject({ trimIn: 1000, trimOut: 2000 });
  store.setSourceTrim(id, "out", 5000);
  expect(useProjectStore.getState().project.timeline.tracks[0]!.clips[0]).toMatchObject({ trimOut: 2000 });
  store.setSourceTrim(id, "in", 500);
  expect(useProjectStore.getState().project.timeline.tracks[0]!.clips[0]).toMatchObject({ trimIn: 520, duration: 1480 });
});
