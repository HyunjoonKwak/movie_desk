import {
  computeDuration,
  inspectProject,
  newId,
  replaceTimeline,
  wouldCreateCycle,
  type SequenceClip,
} from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseCurrentProject, parseProjectExport, toProjectExport } from "../project-export";
import { nestedProject } from "./fixtures/nested-project";

it("survives a cycle created by concurrent legal edits through real Yjs writers", () => {
  const source = nestedProject();
  const p = replaceTimeline(source, {
    ...source.timeline,
    tracks: source.timeline.tracks.map((t) => ({ ...t, clips: [] })),
  });
  const child = p.timelines[1]!;
  const a = new Y.Doc();
  const b = new Y.Doc();
  createProjectCrdt(a).write(p);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(wouldCreateCycle(p, p.rootTimelineId, child.id)).toBe(false);
  expect(wouldCreateCycle(p, child.id, p.rootTimelineId)).toBe(false);
  createProjectCrdt(a).write(source);
  const back: SequenceClip = {
    ...(source.timeline.tracks[0]!.clips[0] as SequenceClip),
    id: newId(),
    timelineId: p.rootTimelineId,
  };
  createProjectCrdt(b).write(
    replaceTimeline(p, {
      ...child,
      tracks: child.tracks.map((t, i) => (i ? t : { ...t, clips: [...t.clips, back] })),
    }),
  );
  const updateA = Y.encodeStateAsUpdate(a);
  const updateB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, updateB);
  Y.applyUpdate(b, updateA);
  for (const doc of [a, b]) {
    const reader = createProjectCrdt(doc);
    const merged = reader.read(p.id, p.timeline)!;
    expect(inspectProject(merged).filter((i) => i.code === "cyclic-sequence")).toHaveLength(2);
    expect(computeDuration(merged)).toBe(0);
    // Retention is deliberate: nothing was removed, so referencesRemoved would lie.
    expect(reader.takeRecoveryReasons()).toEqual([]);
    expect(parseCurrentProject(merged).timelines).toEqual(merged.timelines);
    expect(parseProjectExport(toProjectExport(merged)).project.timelines).toEqual(merged.timelines);
    reader.write(merged);
    expect(reader.read(p.id, p.timeline)!.timelines).toEqual(merged.timelines);
    doc.destroy();
  }
});

it("preserves dangling placed and unplaced targets across JSON and CRDT reloads", () => {
  const p = nestedProject();
  const clip = p.timeline.tracks[0]!.clips[0]!;
  const missing = {
    ...p,
    timelines: [p.timeline],
    preservedClips: [{ timelineId: p.rootTimelineId, clip: { ...clip, id: newId() } }],
  };
  const parsed = parseProjectExport(toProjectExport(missing)).project;
  const doc = new Y.Doc();
  const crdt = createProjectCrdt(doc);
  crdt.write(parsed);
  const read = crdt.read(p.id, p.timeline)!;
  expect(inspectProject(read).filter((i) => i.code === "missing-sequence")).toHaveLength(2);
  expect(read.preservedClips).toEqual(missing.preservedClips);
  expect(computeDuration(read)).toBe(0);
  expect(crdt.takeRecoveryReasons()).toEqual(["clipsPreserved"]);
  doc.destroy();
});
