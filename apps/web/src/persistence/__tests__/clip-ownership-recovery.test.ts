import { type ID, replaceTimeline } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { parseCurrentProject, parseProjectExport, toProjectExport } from "../project-export";
import { preservedClips } from "../preserved-clips";
import { nestedProject } from "./fixtures/nested-project";

it.each(["forward", "third-track", "delete"])(
  "recovers clip ownership after full writer move versus %s on both replicas",
  (variant) => {
    const base = nestedProject();
    const child = base.timelines[1]!;
    const track = child.tracks[0]!;
    const [x, y, z] = ["X", "Y", "Z"].map((id) => ({ ...track.clips[0]!, id: id as ID }));
    const timeline = {
      ...child,
      tracks: [
        { ...track, id: "t1" as ID, clips: [y!, x!] },
        { ...track, id: "t2" as ID, clips: [z!] },
        { ...track, id: "t3" as ID, clips: [] },
      ],
    };
    const p = replaceTimeline(base, timeline);
    const a = new Y.Doc();
    const b = new Y.Doc();
    createProjectCrdt(a).write(p);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const edit = (lists: (typeof track.clips)[]) =>
      replaceTimeline(p, {
        ...timeline,
        tracks: timeline.tracks.map((t, i) => ({ ...t, clips: lists[i]! })),
      });
    createProjectCrdt(a).write(
      edit(variant === "delete" ? [[y!], [z!], []] : [[y!], [z!, x!], []]),
    );
    createProjectCrdt(b).write(
      edit(variant === "third-track" ? [[y!], [z!], [x!]] : [[x!, y!], [z!], []]),
    );
    const updateA = Y.encodeStateAsUpdate(a);
    const updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB);
    Y.applyUpdate(b, updateA);
    const order = (doc: Y.Doc, id: string) =>
      doc.getArray<string>(`timeline-clip-order-v3:${JSON.stringify([child.id, id])}`).toArray();
    expect(order(a, variant === "third-track" ? "t3" : "t1")).toContain("X");
    if (variant !== "delete") expect(order(a, "t2")).toContain("X");
    else expect(a.getMap("clips-v3").has(JSON.stringify([child.id, "X"]))).toBe(false);
    const reads = [a, b].map((doc) => {
      const crdt = createProjectCrdt(doc);
      const result = crdt.read(p.id, p.timeline)!;
      expect(crdt.takeRecoveryReasons()).toContain("referencesRemoved");
      const placements = result.timelines[1]!.tracks.filter((t) =>
        t.clips.some((c) => c.id === "X"),
      );
      expect(placements.map((t) => t.id)).toEqual(
        variant === "delete" ? [] : [variant === "forward" ? "t1" : "t2"],
      );
      crdt.write(result);
      const reopened = new Y.Doc();
      Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
      const next = createProjectCrdt(reopened);
      expect(next.read(p.id, p.timeline)!.timelines).toEqual(result.timelines);
      expect(next.takeRecoveryReasons()).toEqual([]);
      reopened.destroy();
      return result.timelines;
    });
    expect(reads[0]).toEqual(reads[1]);
    a.destroy();
    b.destroy();
  },
);

it("normalizes duplicate clip references in current JSON with first-track ownership", () => {
  const p = nestedProject();
  const t = p.timeline.tracks[0]!;
  const duplicate = replaceTimeline(p, { ...p.timeline, tracks: [t, { ...t, id: "other" as ID }] });
  expect(parseCurrentProject(duplicate).timeline.tracks.map((track) => track.clips.length)).toEqual(
    [1, 0],
  );
});

it.each([false, true])(
  "backs up unplaced clips including missing-track references (%s)",
  (missingTrack) => {
    const p = nestedProject();
    const child = p.timelines[1]!;
    const track = child.tracks[0]!;
    const a = new Y.Doc();
    createProjectCrdt(a).write(p);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    createProjectCrdt(a).write(
      replaceTimeline(p, { ...child, tracks: missingTrack ? [] : [{ ...track, clips: [] }] }),
    );
    const trimmed = { ...track.clips[0]!, duration: 500 };
    createProjectCrdt(b).write(
      replaceTimeline(p, { ...child, tracks: [{ ...track, clips: [trimmed] }] }),
    );
    if (missingTrack) {
      // Concurrent clip insertion leaves an order under deleted track metadata.
      b.getArray(`timeline-clip-order-v3:${JSON.stringify([child.id, track.id])}`).push([
        trimmed.id,
      ]);
    }
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const crdt = createProjectCrdt(a);
    const restored = crdt.read(p.id, p.timeline)!;
    expect(preservedClips(restored)).toEqual([{ timelineId: child.id, clip: trimmed }]);
    const imported = parseProjectExport(
      JSON.parse(JSON.stringify(toProjectExport({ ...restored, name: "Backup" }))),
    ).project;
    expect(preservedClips(imported)).toEqual(preservedClips(restored));
    const fresh = new Y.Doc();
    createProjectCrdt(fresh).write(imported);
    expect(preservedClips(createProjectCrdt(fresh).read(p.id, p.timeline)!)).toEqual(
      preservedClips(restored),
    );
    for (const doc of [a, b, fresh]) doc.destroy();
  },
);
