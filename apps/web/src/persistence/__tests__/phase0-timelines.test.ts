import {
  addClip,
  createEmptyProject,
  findTimeline,
  newId,
  toLegacyProject,
  type Project,
  type MediaClip,
} from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseProjectExport, parseStoredProject, toProjectExport } from "../project-io";
import { createProjectCrdt } from "../project-crdt";

const legacy = () => ({
  id: newId(),
  name: "Existing film",
  createdAt: 10,
  updatedAt: 20,
  framerate: 25,
  resolution: { w: 1280, h: 720 },
  mediaLibrary: [],
  timeline: {
    tracks: [
      {
        id: newId(),
        kind: "audio" as const,
        name: "A1",
        height: 48,
        muted: false,
        solo: true,
        locked: false,
        audio: { gainDb: -6, pan: 0.25, busId: "music" },
        clips: [
          {
            id: newId(),
            kind: "media" as const,
            assetId: newId(),
            start: 400,
            duration: 800,
            trimIn: 20,
            trimOut: 820,
            speed: 1,
            volume: 0.4,
            effects: [],
            keyframes: [
              { target: "volume", keyframes: [{ at: 0, value: 0.2, easing: "linear" as const }] },
            ],
          },
        ],
      },
    ],
    playhead: 200,
    zoom: 0.08,
    duration: 1200,
    markers: [{ id: newId(), at: 400, label: "cue", color: "#ffaa00" }],
  },
  audio: { buses: [{ id: "music", name: "Music", gainDb: -3 }], master: { gainDb: -2 } },
  collections: [{ id: newId(), name: "Future", kind: "future-kind", custom: 42 }],
  customProjectField: { preserved: true },
});
const assertRoot = (project: Project) => {
  expect(findTimeline(project, project.rootTimelineId)).toBe(project.timeline);
  expect(project.timeline.id).toBe(project.rootTimelineId);
};

describe("Phase 0 persistence boundaries", () => {
  it("opens/saves existing JSON without changing any existing field", () => {
    const raw = legacy();
    const project = parseStoredProject(raw);
    assertRoot(project);
    const saved = JSON.parse(JSON.stringify(toLegacyProject(project)));
    expect(saved).toEqual(raw);
    const envelope = {
      schema: "cut_editor-project",
      version: 1,
      exportedAt: 30,
      project: { ...raw, timeline: { ...raw.timeline, magnetic: true } },
    };
    const opened = parseProjectExport(envelope);
    assertRoot(opened.project);
    const exported = JSON.parse(JSON.stringify(toProjectExport(opened.project)));
    expect(exported.project).toEqual(envelope.project);
    expect(exported.version).toBe(envelope.version);
    assertRoot(parseProjectExport(exported).project);
  });

  it("derives the same root after CRDT read and immediate write, keeping schema/data unchanged", () => {
    const project = parseStoredProject(legacy());
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(project);
    const before = JSON.parse(JSON.stringify(doc.toJSON()));
    const loaded = crdt.read(project.id, project.timeline)!;
    assertRoot(loaded);
    expect(loaded.rootTimelineId).toBe(project.rootTimelineId);
    expect(loaded.timeline).toEqual(project.timeline);
    expect(loaded.audio).toEqual(project.audio);
    crdt.write(loaded); // mirrors live-doc's immediate rewrite
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(before);
    expect(doc.getMap("project-meta").get("schemaVersion")).toBe(2);
    expect(doc.getMap("project-meta").has("timelines")).toBe(false);
    expect(doc.getMap("project-meta").has("rootTimelineId")).toBe(false);
    const media: MediaClip = {
      ...(project.timeline.tracks[0]!.clips[0] as MediaClip),
      id: newId(),
      start: 1600,
    };
    const edited = addClip(loaded, loaded.timeline.tracks[0]!.id, media);
    assertRoot(edited);
    crdt.write(edited);
    const reopened = crdt.read(project.id, edited.timeline)!;
    assertRoot(reopened);
    expect(reopened.timeline.duration).toBe(2400);
    doc.destroy();
  });

  it("rejects nested input and unsupported writes instead of losing children", () => {
    const raw = legacy();
    for (const extra of [{ timelines: [] }, { timelines: null }, { rootTimelineId: "missing" }]) {
      expect(() => parseStoredProject({ ...raw, ...extra })).toThrow();
      expect(() =>
        parseProjectExport({
          schema: "cut_editor-project",
          version: 1,
          exportedAt: 30,
          project: { ...raw, ...extra },
        }),
      ).toThrow();
    }
    const base = createEmptyProject();
    const nested = createEmptyProject({
      timelines: [base.timeline, { ...base.timeline, id: newId() }],
      rootTimelineId: base.rootTimelineId,
    });
    expect(() => toProjectExport(nested)).toThrow();
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(base);
    const before = JSON.parse(JSON.stringify(doc.toJSON()));
    expect(() => crdt.write(nested)).toThrow();
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(before);
    doc.destroy();
  });
});
