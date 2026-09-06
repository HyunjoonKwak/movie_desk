import { createEmptyProject, type Project } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseProjectExport, toProjectExport, parseStoredProject } from "../project-export";
import { createProjectCrdt } from "../project-crdt";

const fixture = (): Project => {
  const p = createEmptyProject();
  return {
    ...p,
    audio: {
      buses: [{ id: "bus", name: "Music", gainDb: -3, muted: true }],
      master: { gainDb: -1 },
    },
    timeline: {
      ...p.timeline,
      tracks: p.timeline.tracks.map((t) => ({
        ...t,
        audio: { gainDb: -6, pan: 0.5, busId: "bus" },
      })),
    },
  };
};

describe("audio routing persistence", () => {
  it("round trips JSON and old projects without inserting defaults", () => {
    for (const p of [fixture(), createEmptyProject()])
      expect(parseStoredProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("preserves future fields on project, master, bus and track audio", () => {
    const p = fixture();
    const future = {
      ...p,
      audio: {
        ...p.audio!,
        future: 1,
        master: { ...p.audio!.master, future: 2 },
        buses: p.audio!.buses.map((b) => ({ ...b, future: 3 })),
      },
      timeline: {
        ...p.timeline,
        tracks: p.timeline.tracks.map((t) => ({ ...t, audio: { ...t.audio, future: 4 } })),
      },
    };
    expect(parseStoredProject(JSON.parse(JSON.stringify(future)))).toEqual(future);
    expect(parseProjectExport(JSON.parse(JSON.stringify(toProjectExport(future)))).project).toEqual(
      future,
    );
  });
  it("round trips the versioned JSON export envelope", () => {
    const p = fixture();
    expect(parseProjectExport(JSON.parse(JSON.stringify(toProjectExport(p)))).project).toEqual(p);
  });
  it("round trips a Yjs update and clears removed audio settings", () => {
    const p = fixture();
    const a = new Y.Doc();
    const b = new Y.Doc();
    const crdt = createProjectCrdt(a);
    crdt.write(p);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const restored = createProjectCrdt(b).read(p.id, p.timeline)!;
    expect(restored.audio).toEqual(p.audio);
    expect(restored.timeline.tracks).toEqual(p.timeline.tracks);
    const { audio: _audio, ...legacy } = p;
    crdt.write(legacy);
    expect(crdt.read(p.id, p.timeline)?.audio).toBeUndefined();
    a.destroy();
    b.destroy();
  });
  it("rejects out-of-range gain, pan, nonfinite values and duplicate bus IDs", () => {
    const p = fixture();
    for (const gainDb of [-61, 13, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        parseStoredProject({ ...p, audio: { ...p.audio, master: { gainDb } } }),
      ).toThrow();
    expect(() =>
      parseStoredProject({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: p.timeline.tracks.map((t) => ({ ...t, audio: { pan: 2 } })),
        },
      }),
    ).toThrow();
    expect(() =>
      parseStoredProject({
        ...p,
        audio: { ...p.audio, buses: [...p.audio!.buses, ...p.audio!.buses] },
      }),
    ).toThrow();
  });
});
