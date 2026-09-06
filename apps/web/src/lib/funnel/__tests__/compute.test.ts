import { describe, expect, it } from "vitest";
import { computeFunnel } from "../compute";
import type { FunnelRow, FunnelEvent } from "@/persistence/funnel-log";
let id = 0;
const row = (projectId: string, at: number, event: FunnelEvent): FunnelRow => ({
  id: String(id++),
  projectId,
  at,
  ...event,
});
const complete = (p: string, baseline = false) => [
  row(p, 0, { event: "start", data: { baseline } }),
  row(p, 10, { event: "import", data: { baseline } }),
  row(p, 30, { event: "clip", data: { baseline } }),
  row(p, 60, { event: "export-start", data: {} }),
  row(p, 100, { event: "export-success", data: { assets: 1, clips: 1 } }),
];
describe("local completion funnel", () => {
  it("handles empty and import-only logs", () => {
    expect(computeFunnel([])).toMatchObject({ total: 0, rate: null });
    expect(computeFunnel(complete("a").slice(0, 2))).toMatchObject({
      imported: 1,
      completed: 0,
      rate: 0,
    });
  });
  it("counts projects once and sorts without mutating input", () => {
    const rows = [
      ...complete("a"),
      ...complete("a").slice(4),
      ...complete("b").slice(0, 2),
    ].reverse();
    const copy = [...rows];
    const report = computeFunnel(rows);
    expect(rows).toEqual(copy);
    expect(report).toMatchObject({ total: 2, imported: 2, completed: 1, rate: 0.5 });
    expect(report.stages.map((stage) => stage.medianMs)).toEqual([null, 10, 20, 30, 40]);
  });
  it("excludes baseline and trimmed projects, and rejects empty output as completion", () => {
    const rows = [...complete("a", true), ...complete("b").slice(1), ...complete("c")];
    rows[rows.length - 1] = row("c", 100, {
      event: "export-success",
      data: { assets: 1, clips: 0 },
    });
    expect(computeFunnel(rows)).toMatchObject({
      baseline: 1,
      incomplete: 1,
      imported: 1,
      completed: 0,
    });
  });
  it("pairs pending recovery with later outcomes across hint visibility changes", () => {
    const recovery = (
      p: string,
      at: number,
      result: "pending" | "success" | "abandoned",
      hintVisible: boolean,
    ) => row(p, at, { event: "recovery", data: { kind: "relink", result, hintVisible } });
    const report = computeFunnel([
      recovery("a", 0, "pending", false),
      recovery("b", 1, "pending", false),
      recovery("a", 2, "success", true),
      recovery("c", 3, "abandoned", false),
    ]);
    expect(report.recoveries.filter((r) => r.kind === "relink")).toEqual([
      { kind: "relink", hintVisible: false, success: 0, abandoned: 1, pending: 1 },
      { kind: "relink", hintVisible: true, success: 1, abandoned: 0, pending: 0 },
    ]);
  });
});

it("excludes progress first observed while disabled and impossible completion ordering", () => {
  const baseline = complete("a");
  baseline[1] = row("a", 10, { event: "import", data: { baseline: true } });
  expect(computeFunnel(baseline)).toMatchObject({ baseline: 1, imported: 0, completed: 0 });
  const reversed = complete("b");
  reversed[4] = row("b", 5, { event: "export-success", data: { assets: 1, clips: 1 } });
  expect(computeFunnel(reversed).completed).toBe(0);
});
