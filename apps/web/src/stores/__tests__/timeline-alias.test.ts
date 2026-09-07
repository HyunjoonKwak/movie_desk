import { addClip, createEmptyProject, findTimeline, newId, type MediaClip } from "@movie-desk/core";
import { expect, it } from "vitest";
import { useProjectStore } from "../project-store";

const assertRoot = () => {
  const project = useProjectStore.getState().project;
  expect(findTimeline(project, project.rootTimelineId)).toBe(project.timeline);
  expect(project.timeline.id).toBe(project.rootTimelineId);
  return project;
};

it("keeps root view and mixer state coherent when cancelling a precision gesture", () => {
  const base = createEmptyProject();
  const store = useProjectStore.getState();
  store.loadProject(base);
  const token = store.beginPrecisionEdit("gain");
  store.previewPrecisionEdit(token, () =>
    store.previewMixer({
      kind: "track",
      id: base.timeline.tracks[0]!.id,
      patch: { gainDb: -6 },
    }),
  );
  assertRoot();
  store.setPlayheadMs(250);
  store.setZoomLevel(0.1);
  store.endPrecisionEdit(token, true);
  const cancelled = assertRoot();
  expect(cancelled.timeline.tracks).toBe(base.timeline.tracks);
  expect(cancelled.timeline.playhead).toBe(250);
  expect(cancelled.timeline.zoom).toBe(0.1);
  expect(useProjectStore.getState().history.past).toHaveLength(0);
});

it("publishes drag previews and restores the exact root through undo/redo", () => {
  const base = createEmptyProject();
  const clip: MediaClip = {
    id: newId(),
    assetId: newId(),
    kind: "media",
    start: 0,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    speed: 1,
    effects: [],
    keyframes: [],
  };
  const project = addClip(base, base.timeline.tracks[0]!.id, clip);
  const store = useProjectStore.getState();
  store.loadProject(project);
  store.beginClipDrag();
  store.dragClipTo(clip.id, 2000);
  const preview = assertRoot();
  expect(preview.timeline.tracks[0]?.clips[0]?.start).toBe(2000);
  store.endClipDrag();
  const committed = assertRoot();
  store.undo();
  expect(assertRoot()).toBe(project);
  store.redo();
  expect(assertRoot()).toBe(committed);
});
