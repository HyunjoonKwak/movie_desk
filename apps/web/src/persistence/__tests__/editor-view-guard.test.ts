import { createEmptyProject, createTimelineView, emptyHistory, recordApplied, runCommand, type Project } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseCurrentProject, prepareStoredProject, toProjectExport } from "../project-io";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { editActiveTimeline } from "@/stores/active-timeline";

const fixture = () => {
  const p = createEmptyProject();
  const child = createEmptyProject().timeline;
  const project = { ...p, timelines: [...p.timelines, child] };
  return { project, child, view: createTimelineView(project, child.id) };
};

it("rejects editor views, spread copies and captured callback inputs at persistence/history boundaries", () => {
  const { project, child, view } = fixture();
  useTimelineUiStore.getState().setActiveTimelineId(child.id);
  let captured: Project = project;
  expect(editActiveTimeline(project, (p) => { captured = p; return p; })).toBe(project);
  const doc = new Y.Doc();
  const crdt = createProjectCrdt(doc);
  crdt.write(project);
  const before = Y.encodeStateAsUpdate(doc);
  try {
    for (const leaked of [view, { ...view }, captured]) {
      expect(() => JSON.stringify(leaked)).toThrow("editor timeline view");
      expect(() => parseCurrentProject(leaked)).toThrow("editor timeline view");
      expect(() => prepareStoredProject(leaked)).toThrow("editor timeline view");
      expect(() => toProjectExport(leaked)).toThrow("editor timeline view");
      expect(() => crdt.write(leaked)).toThrow("editor timeline view");
      expect(() => recordApplied(project, leaked, emptyHistory, "leak")).toThrow("editor timeline view");
      expect(() => recordApplied(leaked, project, emptyHistory, "leak")).toThrow("editor timeline view");
      expect(() => runCommand(project, emptyHistory, { label: "leak", apply: () => leaked })).toThrow("editor timeline view");
      expect(() => useProjectStore.getState().loadProject(leaked)).toThrow("editor timeline view");
    }
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    doc.destroy();
    useTimelineUiStore.getState().setActiveTimelineId(null);
  }
});

it("materializes normal child edits before writing canonical root identities", () => {
  const { project, child } = fixture();
  useTimelineUiStore.getState().setActiveTimelineId(child.id);
  try {
    const after = editActiveTimeline(project, (p) => ({ ...p, name: "Edited" }));
    const stored = prepareStoredProject(after);
    expect(stored.rootTimelineId).toBe(project.rootTimelineId);
    expect(stored.timeline.id).toBe(project.rootTimelineId);
    expect(stored.name).toBe("Edited");
    expect(JSON.parse(JSON.stringify(after)).rootTimelineId).toBe(project.rootTimelineId);
    expect(recordApplied(project, after, emptyHistory, "edit").past).toHaveLength(1);
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(after);
    expect(crdt.read(after.id, after.timeline)?.rootTimelineId).toBe(project.rootTimelineId);
    doc.destroy();
  } finally {
    useTimelineUiStore.getState().setActiveTimelineId(null);
  }
});
