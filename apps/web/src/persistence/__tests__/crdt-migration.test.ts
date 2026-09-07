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

it.each(["clip", "track", "metadata", "media", "staging"])(
  "preserves the entire source on failed %s migration",
  (failure) => {
    const p = createEmptyProject();
    const doc = legacyCrdt(p);
    if (failure === "clip")
      doc.getArray(`track-clips-v2:${p.timeline.tracks[0]!.id}`).push(["missing"]);
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
    const parser = vi.spyOn(codec, "parseCurrentProject").mockImplementationOnce((raw) => {
      const candidate = { ...(raw as Record<string, unknown>) };
      expect(candidate.timelines).toEqual(p.timelines);
      expect(candidate.rootTimelineId).toBe(p.rootTimelineId);
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
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      parser.mockRestore();
      doc.destroy();
    }
  },
);
