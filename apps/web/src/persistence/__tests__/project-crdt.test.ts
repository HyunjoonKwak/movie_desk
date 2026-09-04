import {
  type ID,
  type MediaClip,
  type Project,
  type Track,
  createEmptyProject,
} from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";

const asId = (value: string): ID => value as ID;

const track = (id: string): Track => ({
  id: asId(id),
  kind: "video",
  name: id,
  height: 52,
  muted: false,
  solo: false,
  locked: false,
  clips: [],
});

const clip = (id: string, start: number): MediaClip => ({
  id: asId(id),
  kind: "media",
  assetId: asId("asset"),
  start,
  duration: 1000,
  speed: 1,
  trimIn: 0,
  trimOut: 1000,
  effects: [],
  keyframes: [],
});

const withTracks = (project: Project, tracks: readonly Track[]): Project => ({
  ...project,
  timeline: { ...project.timeline, tracks },
});

const exchangeConcurrentUpdates = (
  left: Y.Doc,
  right: Y.Doc,
  leftVector: Uint8Array,
  rightVector: Uint8Array,
) => {
  const leftUpdate = Y.encodeStateAsUpdate(left, leftVector);
  const rightUpdate = Y.encodeStateAsUpdate(right, rightVector);
  Y.applyUpdate(left, rightUpdate);
  Y.applyUpdate(right, leftUpdate);
};

describe("project CRDT", () => {
  it("merges concurrent track additions and independent project fields", () => {
    const base = createEmptyProject();
    const leftDoc = new Y.Doc();
    const left = createProjectCrdt(leftDoc);
    leftDoc.transact(() => left.write(base));

    const rightDoc = new Y.Doc();
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc));
    const right = createProjectCrdt(rightDoc);
    const leftVector = Y.encodeStateVector(leftDoc);
    const rightVector = Y.encodeStateVector(rightDoc);

    leftDoc.transact(() =>
      left.write({
        ...withTracks(base, [...base.timeline.tracks, track("left-track")]),
        name: "Left rename",
      }),
    );
    rightDoc.transact(() =>
      right.write({
        ...withTracks(base, [...base.timeline.tracks, track("right-track")]),
        resolution: { w: 1280, h: 720 },
      }),
    );
    exchangeConcurrentUpdates(leftDoc, rightDoc, leftVector, rightVector);

    const merged = left.read(base.id, base.timeline);
    expect(new Set(merged?.timeline.tracks.map((item) => item.id))).toEqual(
      new Set([...base.timeline.tracks.map((item) => item.id), "left-track", "right-track"]),
    );
    expect(merged?.name).toBe("Left rename");
    expect(merged?.resolution).toEqual({ w: 1280, h: 720 });
    expect(right.read(base.id, base.timeline)?.timeline.tracks).toEqual(merged?.timeline.tracks);
  });

  it("merges clips concurrently inserted into the same track", () => {
    const base = createEmptyProject();
    const baseTrack = base.timeline.tracks[0];
    expect(baseTrack).toBeDefined();
    if (!baseTrack) return;

    const leftDoc = new Y.Doc();
    const left = createProjectCrdt(leftDoc);
    leftDoc.transact(() => left.write(base));
    const rightDoc = new Y.Doc();
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc));
    const right = createProjectCrdt(rightDoc);
    const leftVector = Y.encodeStateVector(leftDoc);
    const rightVector = Y.encodeStateVector(rightDoc);

    const replaceFirstTrack = (item: MediaClip): Project =>
      withTracks(base, [
        { ...baseTrack, clips: [...baseTrack.clips, item] },
        ...base.timeline.tracks.slice(1),
      ]);
    leftDoc.transact(() => left.write(replaceFirstTrack(clip("left-clip", 0))));
    rightDoc.transact(() => right.write(replaceFirstTrack(clip("right-clip", 1000))));
    exchangeConcurrentUpdates(leftDoc, rightDoc, leftVector, rightVector);

    const merged = left.read(base.id, base.timeline);
    expect(new Set(merged?.timeline.tracks[0]?.clips.map((item) => item.id))).toEqual(
      new Set(["left-clip", "right-clip"]),
    );
    expect(merged?.timeline.duration).toBe(2000);
  });

  it("keeps playhead and zoom local while reading shared content", () => {
    const base = createEmptyProject();
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(base);

    const localView = { ...base.timeline, playhead: 900, zoom: 0.25 };
    const rebuilt = crdt.read(base.id, localView);
    expect(rebuilt?.timeline.playhead).toBe(900);
    expect(rebuilt?.timeline.zoom).toBe(0.25);
  });

  it("rejects malformed values in a stored document", () => {
    const base = createEmptyProject();
    const firstTrack = base.timeline.tracks[0];
    expect(firstTrack).toBeDefined();
    if (!firstTrack) return;

    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    crdt.write(base);

    doc.getMap("tracks-v2").set(firstTrack.id, {
      ...firstTrack,
      clips: undefined,
      height: -1,
    });

    expect(crdt.read(base.id, base.timeline)).toBeNull();
  });
});

describe("collections in the CRDT", () => {
  it("round-trips collections and omits the field when there are none", () => {
    const doc = new Y.Doc();
    const crdt = createProjectCrdt(doc);
    const base = createEmptyProject();
    crdt.write(base);
    expect("collections" in (crdt.read(base.id, base.timeline) ?? {})).toBe(false);

    const project: Project = {
      ...base,
      collections: [
        { id: asId("c1"), name: "Trip", kind: "manual", assetIds: [asId("a")] },
        { id: asId("c2"), name: "Best", kind: "smart", query: "#trip", filters: { minRating: 4 } },
      ],
    };
    crdt.write(project);
    const read = crdt.read(project.id, project.timeline);
    expect(read?.collections).toEqual(project.collections);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(createProjectCrdt(peer).read(project.id, project.timeline)?.collections).toEqual(
      project.collections,
    );
  });

  it("keeps collections created concurrently in two documents", () => {
    const base = createEmptyProject();
    const left = new Y.Doc();
    const right = new Y.Doc();
    createProjectCrdt(left).write(base);
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const leftVector = Y.encodeStateVector(left);
    const rightVector = Y.encodeStateVector(right);

    const mine = { id: asId("mine"), name: "Mine", kind: "manual" as const, assetIds: [] };
    const theirs = { id: asId("theirs"), name: "Theirs", kind: "manual" as const, assetIds: [] };
    createProjectCrdt(left).write({ ...base, collections: [mine] });
    createProjectCrdt(right).write({ ...base, collections: [theirs] });
    exchangeConcurrentUpdates(left, right, leftVector, rightVector);

    const merged = createProjectCrdt(left).read(base.id, base.timeline)?.collections ?? [];
    expect(merged.map((c) => c.id).sort()).toEqual(["mine", "theirs"]);
    expect(createProjectCrdt(right).read(base.id, base.timeline)?.collections).toEqual(merged);
  });
});
