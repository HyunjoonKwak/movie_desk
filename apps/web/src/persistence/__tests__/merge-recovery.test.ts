import { type ID, replaceTimeline } from "@movie-desk/core";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { reconcileSequence } from "../crdt-sequence";
import { createProjectCrdt } from "../project-crdt";
import { timelineTrackMapName } from "../timeline-crdt";
import { legacyCrdt } from "./fixtures/legacy-crdt";
import { nestedProject } from "./fixtures/nested-project";

it.each(["timeline", "track", "media", "collection"])(
  "recovers %s deleted in one tab and renamed in another, then saves and reopens",
  (entity) => {
    const base = nestedProject();
    const p = {
      ...base,
      mediaLibrary: [
        {
          id: "asset" as ID,
          name: "Image",
          kind: "image" as const,
          mime: "image/png",
          durationMs: 0,
          opfsPath: "image.png",
          importedAt: 0,
        },
      ],
      collections: [
        { id: "collection" as ID, name: "Collection", kind: "manual" as const, assetIds: [] },
      ],
    };
    const a = new Y.Doc();
    createProjectCrdt(a).write(p);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const child = p.timelines[1]!;
    const mapName =
      entity === "timeline"
        ? "timelines-v3"
        : entity === "track"
          ? timelineTrackMapName(child.id)
          : entity === "media"
            ? "media-v2"
            : "collections-v1";
    const orderName =
      entity === "timeline"
        ? "timeline-order-v3"
        : entity === "track"
          ? `timeline-track-order-v3:${JSON.stringify([child.id])}`
          : entity === "media"
            ? "media-order-v2"
            : "collection-order-v1";
    const id =
      entity === "timeline"
        ? child.id
        : entity === "track"
          ? child.tracks[0]!.id
          : entity === "media"
            ? "asset"
            : "collection";
    const original = b.getMap<Record<string, unknown>>(mapName).get(id)!;
    a.transact(() => {
      a.getMap(mapName).delete(id);
      reconcileSequence(
        a.getArray(orderName),
        a
          .getArray<string>(orderName)
          .toArray()
          .filter((value) => value !== id),
      );
    });
    b.getMap(mapName).set(id, { ...original, name: "Renamed survivor" });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(a.getMap(mapName).has(id)).toBe(true);
    expect(a.getArray<string>(orderName).toArray()).not.toContain(id);
    const crdt = createProjectCrdt(a);
    const recovered = crdt.read(p.id, p.timeline)!;
    expect(crdt.takeRecovery()).toBe(true);
    expect(crdt.takeRecovery()).toBe(false);
    const entities =
      entity === "timeline"
        ? recovered.timelines
        : entity === "track"
          ? recovered.timelines[1]!.tracks
          : entity === "media"
            ? recovered.mediaLibrary
            : recovered.collections!;
    expect(entities.at(-1)).toMatchObject({ id, name: "Renamed survivor" });
    crdt.write({ ...recovered, name: "Next edit" });
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
    expect(reopened.getArray<string>(orderName).toArray()).toContain(id);
    expect(reopened.getMap(mapName).get(id)).toMatchObject({ name: "Renamed survivor" });
    expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.timelines).toEqual(
      recovered.timelines,
    );
    for (const doc of [a, b, reopened]) doc.destroy();
  },
);

it.each([2, 3])(
  "drops missing clip order after actual move-versus-delete in schema %s",
  (version) => {
    const base = nestedProject();
    const first = base.timeline.tracks[0]!;
    const clips = ["A", "B", "D", "C"].map((id) => ({ ...first.clips[0]!, id: id as ID }));
    const p = replaceTimeline(base, {
      ...base.timeline,
      tracks: [{ ...first, clips }, ...base.timeline.tracks.slice(1)],
    });
    const a = version === 2 ? legacyCrdt({ ...p, timelines: [p.timeline] }) : new Y.Doc();
    if (version === 3) createProjectCrdt(a).write(p);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const orderName =
      version === 2
        ? `track-clips-v2:${first.id}`
        : `timeline-clip-order-v3:${JSON.stringify([p.rootTimelineId, first.id])}`;
    const key = version === 2 ? "C" : JSON.stringify([p.rootTimelineId, "C"]);
    const mapName = version === 2 ? "clips" : "clips-v3";
    a.transact(() => {
      a.getMap(mapName).delete(key);
      reconcileSequence(a.getArray(orderName), ["A", "B", "D"]);
    });
    // Moving D after C reinserts C in the array without touching C's map value.
    reconcileSequence(b.getArray(orderName), ["A", "B", "C", "D"]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(a.getArray<string>(orderName).toArray()).toContain("C");
    expect(a.getMap(mapName).has(key)).toBe(false);
    const crdt = createProjectCrdt(a);
    const recovered = crdt.read(p.id, p.timeline)!;
    expect(recovered.timeline.tracks[0]!.clips.map((clip) => clip.id)).toEqual(["A", "B", "D"]);
    expect(crdt.takeRecovery()).toBe(true);
    crdt.write({ ...recovered, name: "Editable after merge" });
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
    expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.name).toBe("Editable after merge");
    for (const doc of [a, b, reopened]) doc.destroy();
  },
);

it("retains the referenced child after full project deletion versus rename writes", () => {
  const p = nestedProject();
  const a = new Y.Doc();
  createProjectCrdt(a).write(p);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  createProjectCrdt(a).write({ ...p, timelines: [p.timeline] });
  createProjectCrdt(b).write({
    ...p,
    timelines: p.timelines.map((timeline, i) =>
      i ? { ...timeline, name: "Renamed child" } : timeline,
    ),
  });
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const crdt = createProjectCrdt(a);
  const recovered = crdt.read(p.id, p.timeline)!;
  expect(recovered.timelines[1]).toMatchObject({ id: p.timelines[1]!.id, name: "Renamed child" });
  expect(recovered.timeline.tracks[0]!.clips[0]).toMatchObject({ timelineId: p.timelines[1]!.id });
  expect(crdt.takeRecovery()).toBe(true);
  crdt.write({ ...recovered, name: "Next edit" });
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
  expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.timelines[1]).toMatchObject({
    id: p.timelines[1]!.id,
    name: "Renamed child",
  });
  for (const doc of [a, b, reopened]) doc.destroy();
});
