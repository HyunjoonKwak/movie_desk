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

import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from "../snapshots";

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
