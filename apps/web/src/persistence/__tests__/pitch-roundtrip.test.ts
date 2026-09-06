import { createEmptyProject, newId, type MediaClip } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseProjectExport, parseStoredProject, toProjectExport } from "../project-export";
import { useProjectStore } from "@/stores/project-store";

it.each([undefined, false, true])(
  "retains preservePitch=%s through JSON, stored schema and the live CRDT",
  (value) => {
    const base = createEmptyProject();
    const clip: MediaClip = {
      id: newId(),
      assetId: newId(),
      kind: "media",
      speed: 2,
      start: 0,
      duration: 1000,
      trimIn: 0,
      trimOut: 2000,
      effects: [],
      keyframes: [],
      ...(value === undefined ? {} : { preservePitch: value }),
    };
    const project = {
      ...base,
      timeline: {
        ...base.timeline,
        duration: 1000,
        tracks: base.timeline.tracks.map((track, i) =>
          i === 0 ? { ...track, clips: [clip] } : track,
        ),
      },
    };
    const parsed = parseProjectExport(JSON.parse(JSON.stringify(toProjectExport(project)))).project;
    const stored = parseStoredProject(JSON.parse(JSON.stringify(project)));
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(project);
    const restored = crdt.read(project.id, project.timeline)!;
    for (const p of [parsed, stored, restored])
      expect(p.timeline.tracks[0]!.clips[0]).toEqual(clip);
    useProjectStore.getState().loadProject(restored);
    useProjectStore.getState().setPreservePitch(clip.id, !value);
    expect(
      (useProjectStore.getState().project.timeline.tracks[0]!.clips[0] as MediaClip).preservePitch,
    ).toBe(!value);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.timeline.tracks[0]!.clips[0]).toEqual(clip);
    doc.destroy();
  },
);
