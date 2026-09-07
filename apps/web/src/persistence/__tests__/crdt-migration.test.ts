import { NestedTimelineError, createEmptyProject } from "@movie-desk/core";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import * as codec from "../project-io";
import { legacyCrdt } from "./fixtures/legacy-crdt";
import { nestedProject } from "./fixtures/nested-project";

it("migrates v2 atomically, retains legacy roots and a restorable pre-migration update", () => {
  const p = createEmptyProject();
  const doc = legacyCrdt(p);
  const before = Y.encodeStateAsUpdate(doc);
  const legacyTracks = doc.getMap("tracks-v2").toJSON();
  let updates = 0;
  doc.on("update", () => updates++);
  const opened = createProjectCrdt(doc).read(p.id, p.timeline)!;
  expect(updates).toBe(1);
  expect(opened.timelines).toEqual([{ ...p.timeline, markers: [] }]);
  expect(doc.getMap("project-meta").get("schemaVersion")).toBe(3);
  expect(doc.getMap("tracks-v2").toJSON()).toEqual(legacyTracks);
  expect(doc.getMap("migration-backup-v2").get("update")).toEqual(before);
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, doc.getMap("migration-backup-v2").get("update") as Uint8Array);
  expect(Y.encodeStateAsUpdate(recovered)).toEqual(before);
  createProjectCrdt(doc).write({ ...opened, name: "Edited legacy" });
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  expect(createProjectCrdt(reopened).read(p.id, p.timeline)).toMatchObject({
    name: "Edited legacy",
    rootTimelineId: p.rootTimelineId,
    timelines: opened.timelines,
  });
  doc.destroy();
  recovered.destroy();
  reopened.destroy();
});

it.each(["track", "metadata", "media", "staging"])(
  "preserves the entire source on failed %s migration",
  (failure) => {
    const p = createEmptyProject();
    const doc = legacyCrdt(p);
    if (failure === "track") doc.getMap("tracks-v2").delete(p.timeline.tracks[0]!.id);
    if (failure === "metadata") doc.getMap("project-meta").set("framerate", -1);
    if (failure === "media") doc.getArray("media-order-v2").push(["missing"]);
    const before = Y.encodeStateAsUpdate(doc);
    const parser =
      failure === "staging"
        ? vi.spyOn(codec, "prepareStoredProject").mockImplementationOnce(() => {
            throw new Error("staged validation failure");
          })
        : null;
    try {
      expect(() => createProjectCrdt(doc).read(p.id, p.timeline)).toThrow(NestedTimelineError);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      expect(doc.getMap("project-meta").get("schemaVersion")).toBe(2);
      expect(doc.getMap("migration-backup-v2").size).toBe(0);
    } finally {
      parser?.mockRestore();
      doc.destroy();
    }
  },
);

it.each(["timelines", "rootTimelineId", "both"])(
  "fails when the production candidate drops %s",
  (field) => {
    const p = nestedProject();
    const doc = new Y.Doc();
    createProjectCrdt(doc).write(p);
    const before = Y.encodeStateAsUpdate(doc);
    const actual = codec.parseCurrentProject;
    let candidate: Record<string, unknown> = {};
    const parser = vi.spyOn(codec, "parseCurrentProject").mockImplementationOnce((raw) => {
      candidate = { ...(raw as Record<string, unknown>) };
      return actual(
        Object.fromEntries(
          Object.entries(candidate).filter(
            ([key]) =>
              !(key === "timelines" && field !== "rootTimelineId") &&
              !(key === "rootTimelineId" && field !== "timelines"),
          ),
        ),
      );
    });
    try {
      expect(() => createProjectCrdt(doc).read(p.id, p.timeline)).toThrow(NestedTimelineError);
      expect(candidate.timelines).toEqual(p.timelines);
      expect(candidate.rootTimelineId).toBe(p.rootTimelineId);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      parser.mockRestore();
      doc.destroy();
    }
  },
);

it.each([2, 3])(
  "opens a schema %s delete-versus-move merge and heals it on the next write",
  (version) => {
    const p = nestedProject();
    const source = version === 2 ? legacyCrdt({ ...p, timelines: [p.timeline] }) : new Y.Doc();
    if (version === 3) createProjectCrdt(source).write(p);
    const a = new Y.Doc();
    const b = new Y.Doc();
    const initial = Y.encodeStateAsUpdate(source);
    Y.applyUpdate(a, initial);
    Y.applyUpdate(b, initial);
    const track = p.timeline.tracks[0]!;
    const clip = track.clips[0]!;
    const mapName = version === 2 ? "clips" : "clips-v3";
    const key = version === 2 ? clip.id : JSON.stringify([p.rootTimelineId, clip.id]);
    const orderName =
      version === 2
        ? `track-clips-v2:${track.id}`
        : `timeline-clip-order-v3:${JSON.stringify([p.rootTimelineId, track.id])}`;
    a.transact(() => {
      a.getMap(mapName).delete(key);
      a.getArray(orderName).delete(0, 1);
    });
    b.getMap(mapName).set(key, { ...clip, start: 500 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(a.getMap(mapName).has(key)).toBe(true);
    expect(a.getArray(orderName).length).toBe(0);
    const crdt = createProjectCrdt(a);
    const recovered = crdt.read(p.id, p.timeline)!;
    expect(recovered.timeline.tracks[0]!.clips).toEqual([]);
    crdt.write({ ...recovered, name: "Recovered edit" });
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
    expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.name).toBe("Recovered edit");
    expect(
      reopened.getMap("clips-v3").has(JSON.stringify([recovered.rootTimelineId, clip.id])),
    ).toBe(false);
    for (const doc of [source, a, b, reopened]) doc.destroy();
  },
);

it("omits an oversized embedded backup while retaining original roots until durable cleanup", () => {
  const p = createEmptyProject();
  const doc = legacyCrdt(p);
  doc.getMap("project").set("snapshot", "x".repeat(2 * 1024 * 1024));
  createProjectCrdt(doc).read(p.id, p.timeline);
  expect(doc.getMap("migration-backup-v2").has("update")).toBe(false);
  expect(doc.getMap("migration-backup-v2").get("pendingCleanup")).toBe(true);
  expect(doc.getMap("project").has("snapshot")).toBe(true);
  doc.destroy();
});

it.each([2, 3])(
  "preserves malformed clip values instead of treating them as deleted in schema %s",
  (version) => {
    const p = nestedProject();
    const doc = version === 2 ? legacyCrdt({ ...p, timelines: [p.timeline] }) : new Y.Doc();
    if (version === 3) createProjectCrdt(doc).write(p);
    const clip = p.timeline.tracks[0]!.clips[0]!;
    doc
      .getMap(version === 2 ? "clips" : "clips-v3")
      .set(version === 2 ? clip.id : JSON.stringify([p.rootTimelineId, clip.id]), null);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => createProjectCrdt(doc).read(p.id, p.timeline)).toThrow(NestedTimelineError);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.destroy();
  },
);
