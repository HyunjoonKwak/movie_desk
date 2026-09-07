import { expect, it, vi } from "vitest";
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

it("drops missing child order and reports recovery without mutating the source", () => {
  const project = nestedProject();
  const doc = new Y.Doc();
  const recovered = vi.fn();
  const crdt = createTimelineCrdt(doc, recovered);
  crdt.write(project);
  doc.getMap("timelines-v3").delete(project.timelines[1]!.id);
  const before = Y.encodeStateAsUpdate(doc);
  expect(crdt.read(project.rootTimelineId, project.timeline)).toEqual([project.timeline]);
  expect(recovered).toHaveBeenCalledWith("referencesRemoved");
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  doc.destroy();
});
