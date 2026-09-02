import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { reconcileSequence, uniqueSequence } from "../crdt-sequence";

describe("CRDT sequence reconciliation", () => {
  it("reorders, inserts, and deletes without leaving duplicates", () => {
    const doc = new Y.Doc();
    const sequence = doc.getArray<string>("tracks");
    sequence.push(["a", "b", "b", "obsolete"]);

    reconcileSequence(sequence, ["b", "c", "a"]);
    expect(sequence.toArray()).toEqual(["b", "c", "a"]);
  });

  it("preserves concurrent insertions from two documents", () => {
    const left = new Y.Doc();
    const leftTracks = left.getArray<string>("tracks");
    leftTracks.push(["base"]);

    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const rightTracks = right.getArray<string>("tracks");
    const leftVector = Y.encodeStateVector(left);
    const rightVector = Y.encodeStateVector(right);

    reconcileSequence(leftTracks, ["base", "left"]);
    reconcileSequence(rightTracks, ["base", "right"]);
    const leftUpdate = Y.encodeStateAsUpdate(left, leftVector);
    const rightUpdate = Y.encodeStateAsUpdate(right, rightVector);
    Y.applyUpdate(left, rightUpdate);
    Y.applyUpdate(right, leftUpdate);

    expect(new Set(uniqueSequence(leftTracks.toArray()))).toEqual(
      new Set(["base", "left", "right"]),
    );
    expect(rightTracks.toArray()).toEqual(leftTracks.toArray());
  });

  it("normalizes duplicate placements after concurrent reorders", () => {
    const left = new Y.Doc();
    const leftTracks = left.getArray<string>("tracks");
    leftTracks.push(["a", "b", "c"]);
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const rightTracks = right.getArray<string>("tracks");
    const leftVector = Y.encodeStateVector(left);
    const rightVector = Y.encodeStateVector(right);

    reconcileSequence(leftTracks, ["b", "a", "c"]);
    reconcileSequence(rightTracks, ["a", "c", "b"]);
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, rightVector));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, leftVector));

    const normalized = uniqueSequence(leftTracks.toArray());
    const leftNormalizationVector = Y.encodeStateVector(left);
    const rightNormalizationVector = Y.encodeStateVector(right);
    reconcileSequence(leftTracks, normalized);
    reconcileSequence(rightTracks, uniqueSequence(rightTracks.toArray()));
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, rightNormalizationVector));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, leftNormalizationVector));

    expect(leftTracks.toArray()).toEqual(rightTracks.toArray());
    expect(new Set(leftTracks.toArray())).toEqual(new Set(["a", "b", "c"]));
    expect(leftTracks).toHaveLength(3);
  });
});
