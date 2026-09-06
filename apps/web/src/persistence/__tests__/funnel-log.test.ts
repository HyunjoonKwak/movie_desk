import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  appendFunnelRow,
  clearFunnelLog,
  discardFunnelQueue,
  flushFunnelLog,
  parseFunnelRow,
  readFunnelRows,
  setFunnelLimitsForTests,
} from "../funnel-log";
const row = (at = 0, projectId = "a".repeat(64)) => ({
  id: crypto.randomUUID(),
  projectId,
  at,
  event: "activity",
  data: { commands: 1, undos: 0 },
});
beforeEach(async () => {
  await clearFunnelLog();
  setFunnelLimitsForTests({ perProject: 20, total: 50 });
});
afterEach(() => {
  setFunnelLimitsForTests();
  vi.restoreAllMocks();
});
it("appends validated rows without storing names, paths or unknown properties", async () => {
  appendFunnelRow({ ...row(), name: "private.mov" });
  appendFunnelRow({ ...row(), data: { path: "/private.mov" } });
  appendFunnelRow({ ...row(), projectId: "private.mov" });
  const saved = await readFunnelRows();
  expect(saved).toHaveLength(1);
  expect(JSON.stringify(saved)).not.toContain("private");
  expect(parseFunnelRow({ ...row(), at: Number.NaN })).toBeNull();
});
it("caps each project and the total, retaining latest append rows", async () => {
  const head = { ...row(0), event: "start", data: { baseline: false } };
  appendFunnelRow(head);
  for (let p = 0; p < 6; p++) {
    for (let n = 0; n < 30; n++) appendFunnelRow(row(p * 100 + n, String(p).repeat(64)));
    await flushFunnelLog();
  }
  const saved = await readFunnelRows();
  expect(saved).toHaveLength(50);
  expect(saved.some((row) => row.id === head.id)).toBe(true);
  expect(saved.filter((r) => r.projectId === "5".repeat(64))).toHaveLength(20);
  expect(Math.min(...saved.filter((r) => r.projectId === "5".repeat(64)).map((r) => r.at))).toBe(
    510,
  );
});
it("ignores database failure and fences queued writes on discard/delete", async () => {
  vi.spyOn(Dexie.prototype, "transaction").mockRejectedValueOnce(new Error("unavailable"));
  appendFunnelRow(row());
  await expect(flushFunnelLog()).resolves.toBeUndefined();
  expect(await readFunnelRows()).toEqual([]);
  appendFunnelRow(row());
  discardFunnelQueue();
  expect(await readFunnelRows()).toEqual([]);
  appendFunnelRow(row());
  await clearFunnelLog();
  expect(await readFunnelRows()).toEqual([]);
});

it("preserves every funnel and recovery row when activity exceeds the project limit", async () => {
  const projectId = "a".repeat(64);
  const heads = [
    { ...row(0), event: "start", data: { baseline: false } },
    { ...row(1), event: "import", data: { baseline: false } },
    { ...row(2), event: "clip", data: { baseline: false } },
    {
      ...row(3),
      event: "recovery",
      data: {
        kind: "relink",
        result: "success",
        hintVisible: false,
        episode: 1,
        assets: 20,
        resolved: 20,
      },
    },
  ];
  for (const head of heads) appendFunnelRow(head);
  for (let n = 0; n < 30; n++) appendFunnelRow(row(n + 4, projectId));
  await flushFunnelLog();
  const saved = await readFunnelRows();
  expect(saved).toHaveLength(20);
  expect(heads.every((head) => saved.some((r) => r.id === head.id))).toBe(true);
});

it.each(["project", "total"])(
  "skips retention at or below the %s limit and trims only above it",
  async (limitKind) => {
    const limit = limitKind === "project" ? 20 : 50;
    // Dexie exposes open connections at runtime but omits them from its public type.
    const database = (Dexie as typeof Dexie & { connections: Dexie[] }).connections.find(
      (db) => db.name === "movie-desk.funnel.v1",
    )!;
    const toArray = vi.spyOn(database.Collection.prototype, "toArray");
    const orderBy = vi.spyOn(database.Table.prototype, "orderBy");
    const bulkDelete = vi.spyOn(database.Table.prototype, "bulkDelete");
    for (let n = 0; n < limit; n++) {
      appendFunnelRow(
        row(n, limitKind === "project" ? "a".repeat(64) : String(Math.floor(n / 20)).repeat(64)),
      );
      if (n === limit - 2) await flushFunnelLog();
    }
    await flushFunnelLog();
    expect(toArray).not.toHaveBeenCalled();
    expect(orderBy).not.toHaveBeenCalled();
    expect(bulkDelete).not.toHaveBeenCalled();
    const keys = vi.spyOn(database.Collection.prototype, "keys");
    appendFunnelRow({ ...row(limit), event: "start", data: { baseline: false } });
    await flushFunnelLog();
    expect(toArray).not.toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledWith("[projectId+at+event+id]");
    expect(keys).toHaveBeenCalledTimes(1);
    expect(bulkDelete).toHaveBeenCalledTimes(1);
    expect(bulkDelete.mock.calls[0]?.[0]).toHaveLength(1);
    const saved = await readFunnelRows();
    expect(saved).toHaveLength(limit);
    expect(saved.some((r) => r.event === "start")).toBe(true);
    expect(saved.some((r) => r.at === 0)).toBe(false);
  },
);
