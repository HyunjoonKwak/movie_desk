import { NestedTimelineError } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createTimelineCrdt, timelineClipKey } from "../timeline-crdt";
import { nestedProject } from "./fixtures/nested-project";

it("namespaces timeline, track, clip order and duplicate clip IDs losslessly", () => {
  const project = nestedProject();
  const doc = new Y.Doc();
  createTimelineCrdt(doc).write(project);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
  expect(createTimelineCrdt(restored).read(project.rootTimelineId, project.timeline)).toEqual(
    project.timelines,
  );
  expect(restored.getMap("clips-v3").size).toBe(2);
  expect(timelineClipKey("a:b", "c")).not.toBe(timelineClipKey("a", "b:c"));
  doc.destroy();
  restored.destroy();
});

it("stops on missing child metadata instead of silently dropping children", () => {
  const project = nestedProject();
  const doc = new Y.Doc();
  const crdt = createTimelineCrdt(doc);
  crdt.write(project);
  doc.getMap("timelines-v3").delete(project.timelines[1]!.id);
  const before = Y.encodeStateAsUpdate(doc);
  expect(() => crdt.read(project.rootTimelineId, project.timeline)).toThrow(NestedTimelineError);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  doc.destroy();
});
