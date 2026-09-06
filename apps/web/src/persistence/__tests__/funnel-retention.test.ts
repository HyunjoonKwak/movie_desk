import { expect, it } from "vitest";
import { trimFunnelRows, type FunnelRow } from "../funnel-log";

const row = (
  id: string,
  projectId: string,
  at: number,
  event: FunnelRow["event"] = "activity",
) => ({
  id,
  projectId,
  at,
  event,
});
const protectedRows = [
  "start",
  "path",
  "import",
  "clip",
  "export-start",
  "export-success",
  "export-failure",
  "recovery",
].map((event, at) => row(`protected-${at}`, "a", at, event as FunnelRow["event"]));
it("keeps all protected events even beyond both caps and only trims activity", () => {
  const rows = [...protectedRows, row("old", "a", 10), row("new", "a", 11)];
  expect(trimFunnelRows(rows, 1, 1)).toEqual(protectedRows);
  expect(rows).toHaveLength(10);
});
it("applies the project cap independently and then the global cap to latest activity", () => {
  const rows = [
    row("a1", "a", 1),
    row("a2", "a", 2),
    row("a3", "a", 3),
    row("b1", "b", 4),
    row("b2", "b", 5),
  ];
  expect(trimFunnelRows(rows, 2, 10).map((r) => r.id)).toEqual(["a2", "a3", "b1", "b2"]);
  expect(trimFunnelRows(rows, 2, 3).map((r) => r.id)).toEqual(["a3", "b1", "b2"]);
});
it.each([
  [0, 10],
  [-1, 10],
  [10, 0],
  [10, -1],
  [0, 0],
  [-1, -1],
])("defends caps %i/%i while preserving evidence", (perProject, total) => {
  expect(trimFunnelRows([...protectedRows, row("activity", "b", 20)], perProject, total)).toEqual(
    protectedRows,
  );
  expect(trimFunnelRows([row("activity", "b", 20)], perProject, total)).toEqual([]);
});
it("counts protected evidence against the activity budget and trims legacy command/undo", () => {
  const start = row("start", "a", 0, "start");
  const rows = [
    start,
    row("command", "a", 1, "command"),
    row("undo", "a", 2, "undo"),
    row("activity", "a", 3),
  ];
  expect(trimFunnelRows(rows, 2, 10)).toEqual([start, rows[3]]);
  expect(trimFunnelRows(rows, 10, 2)).toEqual([start, rows[3]]);
});
