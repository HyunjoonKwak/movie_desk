import { afterEach, expect, it, vi } from "vitest";
import { createExportEpisode, createRecoveryEpisode, recoveryHintVisible } from "../episodes";
import { computeFunnel } from "../compute";
import type { FunnelEvent, FunnelRow } from "@/persistence/funnel-log";
afterEach(() => vi.unstubAllGlobals());
it("save chooser cancellation never succeeds; a multi-preset export has one result", () => {
  const emit = vi.fn();
  const cancelled = createExportEpisode("a", 1, 1, emit);
  cancelled.record("cancelled");
  cancelled.finish();
  cancelled.finish();
  expect(emit.mock.calls.map((call) => call[1].event)).toEqual(["export-start", "export-failure"]);
  emit.mockClear();
  const multi = createExportEpisode("a", 1, 1, emit);
  multi.record("success");
  expect(emit.mock.calls).toHaveLength(2); // durable capture begins at the first saved preset
  multi.record("success");
  multi.record("cancelled");
  multi.finish();
  expect(emit.mock.calls.map((call) => call[1].event)).toEqual(["export-start", "export-success"]);
});
it("19 of 20 then close is one abandoned episode with resolved counts; repeated cancel is inert", () => {
  const events: FunnelEvent[] = [];
  const episode = createRecoveryEpisode("a", "relink", 20, 1, null, (_id, event) =>
    events.push(event),
  );
  for (let i = 0; i < 19; i++) episode.resolve();
  episode.abandon();
  episode.abandon();
  episode.resolve();
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ data: { assets: 20, resolved: 19, result: "abandoned" } });
  const rows = events.map((event, at) => ({
    ...event,
    at,
    id: String(at),
    projectId: "a",
  })) as FunnelRow[];
  expect(
    computeFunnel(rows).recoveries.find((r) => r.kind === "relink" && !r.hintVisible),
  ).toMatchObject({ success: 0, abandoned: 1, pending: 0 });
});
it("separate episodes keep separate pending states and success is final", () => {
  const events: FunnelEvent[] = [];
  const emit = (_id: string, event: FunnelEvent) => events.push(event);
  const one = createRecoveryEpisode("a", "relink", 2, 1, null, emit);
  createRecoveryEpisode("a", "relink", 2, 2, null, emit);
  one.resolve(2);
  one.abandon();
  const rows = events.map((event, at) => ({
    ...event,
    at,
    id: String(at),
    projectId: "a",
  })) as FunnelRow[];
  expect(
    computeFunnel(rows).recoveries.find((r) => r.kind === "relink" && !r.hintVisible),
  ).toMatchObject({ success: 1, abandoned: 0, pending: 1 });
});
it("only the recovery-specific C2 hint counts, never unrelated or report hints", () => {
  const querySelector = vi.fn().mockReturnValue(null);
  vi.stubGlobal("document", { querySelector });
  expect(recoveryHintVisible(null)).toBe(false);
  expect(querySelector).not.toHaveBeenCalled();
  expect(recoveryHintVisible("media-missing-hint")).toBe(false);
  expect(querySelector).toHaveBeenCalledWith('[data-state-hint][data-testid="media-missing-hint"]');
  querySelector.mockReturnValue({ getClientRects: () => [{}] });
  expect(recoveryHintVisible("media-missing-hint")).toBe(true);
});
