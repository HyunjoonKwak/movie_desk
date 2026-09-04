import type { ID, MediaAsset } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Trash rows live in IndexedDB; node has none, so Dexie is a small in-memory
// table with the calls trash.ts makes.

interface Row {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  deletedAt: number;
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
    toArray = async () => [...rows.values()];
    where = (field: keyof Row) => ({
      equals: (value: unknown) => {
        const matched = () => [...rows.values()].filter((row) => row[field] === value);
        let reversed = false;
        const query = {
          reverse: () => {
            reversed = true;
            return query;
          },
          sortBy: async (key: keyof Row) => {
            const sorted = [...matched()].sort((a, b) =>
              a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0,
            );
            return reversed ? sorted.reverse() : sorted;
          },
          count: async () => matched().length,
          delete: async () => {
            for (const row of matched()) rows.delete(row.id);
          },
        };
        return query;
      },
    });
  }
  class FakeDexie {
    trash: FakeTable | undefined;
    version() {
      return {
        stores: () => {
          this.trash = new FakeTable();
        },
      };
    }
  }
  return { default: FakeDexie };
});

import {
  TRASH_RETENTION_MS,
  countTrash,
  deleteTrashEntry,
  emptyTrash,
  listTrash,
  moveAssetToTrash,
  readTrashedAsset,
  trashMediaKeys,
} from "../trash";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: id as ID,
  name: `${id}.mp4`,
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: `${id}__${id}.mp4`,
  sizeBytes: 1,
  importedAt: 0,
  ...patch,
});

const project = "p1" as ID;

beforeEach(() => {
  rows.clear();
});

describe("trash", () => {
  it("keeps removed assets per project, newest first, and restores their records", async () => {
    await moveAssetToTrash(project, asset("a"));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await moveAssetToTrash(project, asset("b", { proxyPath: "b__proxy.mp4" }));
    await moveAssetToTrash("other" as ID, asset("c"));

    expect(await countTrash(project)).toBe(2);
    expect((await listTrash(project)).map((row) => row.name)).toEqual(["b.mp4", "a.mp4"]);
    const restored = await readTrashedAsset("b");
    expect(restored?.proxyPath).toBe("b__proxy.mp4");
    await deleteTrashEntry("b");
    expect(await countTrash(project)).toBe(1);
    await emptyTrash(project);
    expect(await countTrash(project)).toBe(0);
    expect(await countTrash("other" as ID)).toBe(1);
  });

  it("returns null for a damaged row", async () => {
    rows.set("bad", {
      id: "bad",
      projectId: project,
      name: "x",
      kind: "video",
      deletedAt: 1,
      json: "{nope",
    });
    expect(await readTrashedAsset("bad")).toBeNull();
  });

  it("keeps trashed files alive for GC until the entry expires", async () => {
    const now = 1_000_000;
    rows.set("fresh", {
      id: "fresh",
      projectId: project,
      name: "f",
      kind: "video",
      deletedAt: now - 1000,
      json: JSON.stringify(asset("fresh", { proxyPath: "fresh__proxy.mp4" })),
    });
    rows.set("old", {
      id: "old",
      projectId: project,
      name: "o",
      kind: "video",
      deletedAt: now - TRASH_RETENTION_MS - 1,
      json: JSON.stringify(asset("old")),
    });
    const keep = new Set<string>();
    await trashMediaKeys(keep, now);
    expect([...keep].sort()).toEqual(["fresh__fresh.mp4", "fresh__proxy.mp4"]);
    expect(rows.has("old")).toBe(false);
  });
});
