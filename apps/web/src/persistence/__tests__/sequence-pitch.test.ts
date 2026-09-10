import { createEmptyProject, newId, type Project, type SequenceClip } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseCurrentProject, parseProjectExport, toProjectExport } from "../project-export";

const nested = (preservePitch?: boolean): Project => {
  const base = createEmptyProject();
  const childBase = createEmptyProject().timeline;
  const child = { ...childBase, id: newId(), duration: 1000 };
  const sequence: SequenceClip = {
    id: newId(),
    kind: "sequence",
    timelineId: child.id,
    start: 0,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    speed: 2,
    effects: [],
    keyframes: [],
    ...(preservePitch === undefined ? {} : { preservePitch }),
  };
  const root = {
    ...base.timeline,
    duration: 1000,
    tracks: base.timeline.tracks.map((t, i) => (i ? t : { ...t, clips: [sequence] })),
  };
  return { ...base, timeline: root, timelines: [root, child] };
};

const sequenceOf = (project: Project) =>
  project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.kind === "sequence") as SequenceClip;

it("opens a document written before the field existed and keeps varispeed", () => {
  const legacy = nested();
  // Simulate a document from before this field: written without it at all.
  const raw = JSON.parse(
    JSON.stringify(toProjectExport(legacy), (key, value) =>
      key === "preservePitch" ? undefined : value,
    ),
  );
  const parsed = parseProjectExport(raw);
  expect(sequenceOf(parsed.project).preservePitch).toBeUndefined();
});

it("round-trips the flag through JSON export and import", () => {
  const project = nested(true);
  const back = parseProjectExport(JSON.parse(JSON.stringify(toProjectExport(project))));
  expect(sequenceOf(back.project).preservePitch).toBe(true);
});

it("keeps the flag through a CRDT write and read", () => {
  const project = nested(true);
  const doc = new Y.Doc();
  createProjectCrdt(doc).write(project);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  const read = createProjectCrdt(reopened).read(project.id, project.timeline)!;
  expect(sequenceOf(read).preservePitch).toBe(true);
  doc.destroy();
  reopened.destroy();
});

it("survives a merge between one replica that set it and one that did not", () => {
  const project = nested();
  const a = new Y.Doc();
  const b = new Y.Doc();
  createProjectCrdt(a).write(project);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  const sequence = sequenceOf(project);
  const enabled = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === sequence.id ? { ...c, preservePitch: true } : c)),
      })),
    },
  };
  createProjectCrdt(a).write({ ...enabled, timelines: [enabled.timeline, project.timelines[1]!] });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  const read = createProjectCrdt(b).read(project.id, project.timeline)!;
  expect(sequenceOf(read).preservePitch).toBe(true);
  a.destroy();
  b.destroy();
});

it("rejects a non-boolean value rather than storing it", () => {
  const project = nested();
  const raw = JSON.parse(JSON.stringify(toProjectExport(project)));
  raw.project.timelines[0].tracks[0].clips[0].preservePitch = "yes";
  expect(() => parseCurrentProject(raw.project)).toThrow();
});
