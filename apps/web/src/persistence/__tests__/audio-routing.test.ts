import {
  type Project,
  createEmptyProject,
  syncRootTimeline,
  toLegacyProject,
} from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import {
  parseProjectExport,
  parseStoredProject,
  takeAudioRecovery,
  toProjectExport,
} from "../project-io";

const fixture = (): Project => {
  const p = createEmptyProject();
  return syncRootTimeline({
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
  });
};

describe("audio routing persistence", () => {
  it("round trips JSON and old projects without inserting defaults", () => {
    for (const p of [fixture(), createEmptyProject()])
      expect(parseStoredProject(JSON.parse(JSON.stringify(toLegacyProject(p))))).toEqual(p);
  });
  it("preserves future fields on project, master, bus and track audio", () => {
    const p = fixture();
    const futureFields = {
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
    const future = syncRootTimeline(futureFields);
    expect(parseStoredProject(JSON.parse(JSON.stringify(toLegacyProject(future))))).toEqual(future);
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
  it("drops only invalid audio blocks while opening the rest of the project", () => {
    const p = fixture();
    const { audio: _audio, ...withoutAudio } = p;
    const invalid = [-61, 13, Number.NaN, Number.POSITIVE_INFINITY].map((gainDb) => ({
      ...toLegacyProject(p),
      audio: { ...p.audio, master: { gainDb } },
    }));
    invalid.push({
      ...toLegacyProject(p),
      audio: { ...p.audio!, buses: [...p.audio!.buses, ...p.audio!.buses] },
    });
    for (const raw of invalid) {
      const parsed = parseStoredProject(raw);
      expect(parsed).toEqual(withoutAudio);
      expect("audio" in parsed).toBe(false);
      expect(takeAudioRecovery(parsed)).toBe(true);
      expect(takeAudioRecovery(parsed)).toBe(false);
      const exported = parseProjectExport({
        ...toProjectExport(p),
        version: 1,
        project: raw,
      }).project;
      expect(exported).toEqual(withoutAudio);
      expect(takeAudioRecovery(exported)).toBe(true);
    }
    const badTrack = {
      ...toLegacyProject(p),
      timeline: {
        ...p.timeline,
        tracks: p.timeline.tracks.map((t, i) => (i === 0 ? { ...t, audio: { pan: 2 } } : t)),
      },
    };
    const restored = parseStoredProject(badTrack);
    expect(restored.audio).toEqual(p.audio);
    expect("audio" in restored.timeline.tracks[0]!).toBe(false);
    expect(restored.timeline.tracks[1]).toEqual(p.timeline.tracks[1]);
    expect(takeAudioRecovery(restored)).toBe(true);
    expect(() => parseStoredProject({ ...p, timeline: { ...p.timeline, tracks: null } })).toThrow();
  });
});
