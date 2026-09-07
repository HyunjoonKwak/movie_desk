import { NestedTimelineError, replaceTimeline } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseProjectExport, parseStoredProject, toProjectExport } from "../project-io";
import { nestedProject } from "./fixtures/nested-project";

describe("nested persistence", () => {
  it("round-trips all timelines through JSON and preserves the root alias", () => {
    const project = nestedProject();
    const envelope = toProjectExport(project);
    expect(envelope.version).toBe(2);
    const loaded = parseProjectExport(JSON.parse(JSON.stringify(envelope))).project;
    expect(loaded).toEqual(project);
    expect(loaded.timeline).toBe(loaded.timelines[0]);
    expect(parseStoredProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("keeps children and colliding IDs across CRDT reload, immediate rewrite, and child edit", () => {
    const project = nestedProject();
    const doc = new Y.Doc();
    createProjectCrdt(doc).write(project);
    const reopenedDoc = new Y.Doc();
    Y.applyUpdate(reopenedDoc, Y.encodeStateAsUpdate(doc));
    const crdt = createProjectCrdt(reopenedDoc);
    const loaded = crdt.read(project.id, project.timeline)!;
    expect(loaded.timelines).toEqual(project.timelines);
    expect(loaded.rootTimelineId).toBe(project.rootTimelineId);
    expect(loaded.timeline).toBe(loaded.timelines[0]);
    crdt.write(loaded); // loadProject -> immediate live-doc rewrite
    const child = loaded.timelines[1]!;
    const edited = replaceTimeline(loaded, {
      ...child,
      tracks: child.tracks.map((track) => ({
        ...track,
        name: "Child edit",
        clips: track.clips.map((clip) => ({ ...clip, label: "Edited" })),
      })),
    });
    crdt.write(edited);
    const thirdDoc = new Y.Doc();
    Y.applyUpdate(thirdDoc, Y.encodeStateAsUpdate(reopenedDoc));
    const final = createProjectCrdt(thirdDoc).read(project.id, project.timeline)!;
    expect(final.timelines).toEqual(edited.timelines);
    expect(final.timeline).toEqual(project.timeline);
    doc.destroy();
    reopenedDoc.destroy();
    thirdDoc.destroy();
  });

  it.each(["timelines", "rootTimelineId"])(
    "rejects missing %s in v2 instead of inferring v1",
    (field) => {
      const envelope = JSON.parse(JSON.stringify(toProjectExport(nestedProject())));
      delete envelope.project[field];
      expect(() => parseProjectExport(envelope)).toThrow(NestedTimelineError);
    },
  );

  it("rejects malformed child/sequence data without changing its source", () => {
    const project = nestedProject();
    const malformedChild = (changes: Record<string, unknown>) => ({
      ...project,
      timelines: project.timelines.map((timeline, i) =>
        i !== 1
          ? timeline
          : {
              ...timeline,
              tracks: timeline.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, ...changes })),
              })),
            },
      ),
    });
    for (const raw of [
      { ...project, timelines: null },
      { ...project, rootTimelineId: "missing" },
      malformedChild({ kind: "future" }),
      malformedChild({ kind: "sequence", timelineId: project.rootTimelineId, trimIn: -1 }),
      { ...project, timelines: [...project.timelines, project.timelines[1]] },
    ]) {
      const before = JSON.stringify(raw);
      expect(() => parseStoredProject(raw)).toThrow(NestedTimelineError);
      expect(JSON.stringify(raw)).toBe(before);
    }
  });
});
