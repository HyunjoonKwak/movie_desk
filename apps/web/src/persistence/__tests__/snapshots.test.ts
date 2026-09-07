import { type ID, createEmptyProject, toLegacyProject } from "@movie-desk/core";
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
    bulkGet = async (ids: string[]) => ids.map((id) => rows.get(id));
    bulkDelete = async (ids: string[]) => {
      for (const id of ids) rows.delete(id);
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
  deleteSnapshot,
  forEachSnapshotJson,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
  snapshotCleanupCandidates,
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
    expect(restored).toEqual(project);
    expect(restored?.timelines[0]).toBe(restored?.timeline);
    expect(JSON.parse(listed[1]!.json)).toEqual(project);
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
      json: JSON.stringify(toLegacyProject(project)),
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

it("round-trips nested snapshots and preserves every child", async () => {
  const { nestedProject } = await import("./fixtures/nested-project");
  const p = nestedProject();
  await saveSnapshot(p, "Nested");
  const rows = await listSnapshots(p.id);
  expect(await loadSnapshot(rows[0]!.id)).toEqual(p);
});

it("opens legacy snapshots in memory, then saves and reopens edited current snapshots", async () => {
  const p = createEmptyProject({ name: "Legacy snapshot" });
  const row = {
    id: "legacy",
    projectId: p.id,
    label: "Old",
    createdAt: 0,
    json: JSON.stringify(toLegacyProject(p)),
  };
  rows.set(row.id, row);
  const loaded = await loadSnapshot(row.id);
  expect(loaded).toEqual(p);
  expect(rows.get(row.id)).toBe(row);
  await saveSnapshot({ ...loaded!, name: "Edited" }, "Edited");
  const latest = (await listSnapshots(p.id))[0]!;
  expect(await loadSnapshot(latest.id)).toEqual({ ...p, name: "Edited" });
  expect(rows.get(row.id)).toBe(row);
});

it("preserves a failed nested snapshot migration exactly", async () => {
  const { nestedProject } = await import("./fixtures/nested-project");
  const p = nestedProject();
  const row = {
    id: "bad-nested",
    projectId: p.id,
    label: "Keep me",
    createdAt: 0,
    json: JSON.stringify({ ...p, rootTimelineId: "missing" }),
  };
  rows.set(row.id, row);
  expect(await loadSnapshot(row.id)).toBeNull();
  expect(rows.get(row.id)).toBe(row);
});
