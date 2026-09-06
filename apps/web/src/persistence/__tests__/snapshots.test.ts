import { type ID, createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Snapshots are frozen project JSON in IndexedDB. Node has no IndexedDB, so
// Dexie is replaced by a tiny in-memory table with the calls snapshots.ts
// makes; what matters here is the round trip and the corrupt-row contract.

interface Row {
  id: string;
  projectId: string;
  label: string;
  createdAt: number;
  json: string;
}

const rows = new Map<string, Row>();

vi.mock("dexie", () => {
  class FakeTable {
    put = async (row: Row) => {
      rows.set(row.id, row);
    };
    each = async (visit: (row: Row) => void) => {
      for (const row of rows.values()) visit(row);
    };
    get = async (id: string) => rows.get(id);
    delete = async (id: string) => {
      rows.delete(id);
    };
    where = (field: keyof Row) => ({
      equals: (value: unknown) => {
        const matched = [...rows.values()].filter((row) => row[field] === value);
        let reversed = false;
        const query = {
          reverse: () => {
            reversed = true;
            return query;
          },
          sortBy: async (key: keyof Row) => {
            const sorted = [...matched].sort((a, b) =>
              a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0,
            );
            return reversed ? sorted.reverse() : sorted;
          },
        };
        return query;
      },
    });
  }
  // Like Dexie, the table appears when stores() runs — after the subclass's
  // own field initialisers, which would otherwise reset it to undefined.
  class FakeDexie {
    snapshots: FakeTable | undefined;
    transaction = async (_mode: string, _table: unknown, run: () => Promise<void>) => run();
    version() {
      return {
        stores: () => {
          this.snapshots = new FakeTable();
        },
      };
    }
  }
  return { default: FakeDexie };
});

import {
  cleanupSnapshots,
  forEachSnapshotJson,
  snapshotCleanupCandidates,
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
} from "../snapshots";

beforeEach(() => {
  rows.clear();
});

describe("snapshots", () => {
  it("round-trips a project and lists a project's snapshots newest first", async () => {
    const project = createEmptyProject({ name: "trip" });
    await saveSnapshot(project, "first");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveSnapshot(project, "second");
    await saveSnapshot(createEmptyProject({ name: "other" }), "elsewhere");

    const listed = await listSnapshots(project.id);
    expect(listed.map((s) => s.label)).toEqual(["second", "first"]);
    const restored = await loadSnapshot(listed[1]?.id as string);
    expect(restored?.name).toBe("trip");
    expect(restored?.id).toBe(project.id);
  });

  it("returns null for a damaged or unknown snapshot instead of throwing", async () => {
    rows.set("broken", {
      id: "broken",
      projectId: "p" as ID,
      label: "x",
      createdAt: 1,
      json: "{not json",
    });
    rows.set("wrong-shape", {
      id: "wrong-shape",
      projectId: "p" as ID,
      label: "y",
      createdAt: 2,
      json: JSON.stringify({ id: "p", timeline: { tracks: "nope" } }),
    });
    expect(await loadSnapshot("broken")).toBeNull();
    expect(await loadSnapshot("wrong-shape")).toBeNull();
    expect(await loadSnapshot("missing")).toBeNull();
  });

  it("deletes a snapshot", async () => {
    const project = createEmptyProject({ name: "trip" });
    await saveSnapshot(project, "only");
    const [only] = await listSnapshots(project.id);
    await deleteSnapshot(only?.id as string);
    expect(await listSnapshots(project.id)).toEqual([]);
  });
});

it("proposes oldest overflow without deleting and cleans only confirmed project ids", async () => {
  const project = createEmptyProject();
  for (let i = 0; i < 23; i++) {
    rows.set(String(i), {
      id: String(i),
      projectId: project.id,
      createdAt: i,
      label: String(i),
      json: JSON.stringify(project),
    });
  }
  rows.set("other", { id: "other", projectId: "other", createdAt: 0, label: "other", json: "{}" });
  const candidates = snapshotCleanupCandidates(await listSnapshots(project.id));
  expect(candidates.map((row) => row.id)).toEqual(["0", "1", "2"]);
  expect(rows.size).toBe(24);
  await cleanupSnapshots(project.id, [...candidates.map((row) => row.id), "other"]);
  expect(await listSnapshots(project.id)).toHaveLength(20);
  expect(rows.has("other")).toBe(true);
  const retained: string[] = [];
  await forEachSnapshotJson((json) => retained.push(json));
  expect(retained).toHaveLength(21);
  expect(snapshotCleanupCandidates(await listSnapshots(project.id))).toEqual([]);
  expect(() => snapshotCleanupCandidates([], 0)).toThrow(RangeError);
});
