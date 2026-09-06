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
});
afterEach(() => {
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
    for (let n = 0; n < 1010; n++) appendFunnelRow(row(p * 2000 + n, String(p).repeat(64)));
    await flushFunnelLog();
  }
  const saved = await readFunnelRows();
  expect(saved).toHaveLength(5000);
  expect(saved.some((row) => row.id === head.id)).toBe(true);
  expect(saved.filter((r) => r.projectId === "5".repeat(64))).toHaveLength(1000);
  expect(Math.min(...saved.filter((r) => r.projectId === "5".repeat(64)).map((r) => r.at))).toBe(
    10010,
  );
}, 15000);
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
  for (let n = 0; n < 1100; n++) appendFunnelRow(row(n + 4, projectId));
  await flushFunnelLog();
  const saved = await readFunnelRows();
  expect(saved).toHaveLength(1000);
  expect(heads.every((head) => saved.some((r) => r.id === head.id))).toBe(true);
}, 15000);
