import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, type MediaAsset } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import {
  observeFunnel,
  mountFunnel,
  recordExport,
  recordFunnel,
  setFunnelEnabled,
  settleFunnelCollection,
} from "../collector";
vi.mock("@/persistence/funnel-log", () => ({
  appendFunnelRow: vi.fn(),
  discardFunnelQueue: vi.fn(),
  flushFunnelLog: vi.fn().mockResolvedValue(undefined),
}));
import { appendFunnelRow } from "@/persistence/funnel-log";
afterEach(() => {
  setFunnelEnabled(false);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("off records nothing and does not subscribe", async () => {
  const subscribe = vi.spyOn(useProjectStore, "subscribe");
  setFunnelEnabled(false);
  recordFunnel("secret", { event: "start", data: { baseline: false } });
  await settleFunnelCollection();
  expect(appendFunnelRow).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  subscribe.mockRestore();
});
it("observes the first import/0-to-1 clip once and ignores playhead changes", () => {
  const initial = { ...useProjectStore.getState(), project: createEmptyProject() };
  let listener: Parameters<Parameters<typeof observeFunnel>[1]>[0] = () => {};
  const emit = vi.fn();
  const stop = vi.fn();
  const dispose = observeFunnel(
    initial,
    (next) => {
      listener = next;
      return stop;
    },
    emit,
  );
  const project = { ...initial.project, mediaLibrary: [{ id: "asset" } as MediaAsset] };
  const imported = { ...initial, project };
  listener(imported, initial);
  const placed = {
    ...imported,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [{ id: "track", kind: "video", clips: [{ id: "clip" }] }],
      },
    },
  } as unknown as typeof initial;
  listener(placed, imported);
  listener(imported, placed);
  listener(placed, imported);
  listener({ ...placed }, placed);
  expect(emit.mock.calls.filter((call) => call[1].event === "import")).toHaveLength(1);
  expect(emit.mock.calls.filter((call) => call[1].event === "clip")).toHaveLength(1);
  dispose();
  expect(stop).toHaveBeenCalledOnce();
});
it("removes the opt-in subscription and drops pending async hashing on disable", async () => {
  setFunnelEnabled(true);
  recordFunnel("file-name-as-external-id.mov", { event: "command", data: {} });
  setFunnelEnabled(false);
  await settleFunnelCollection();
  expect(appendFunnelRow).not.toHaveBeenCalled();
});

it("counts new commands after undo, but excludes redo and reset", () => {
  const initial = {
    ...useProjectStore.getState(),
    project: createEmptyProject(),
    history: { past: [], future: [] },
  };
  let listener: Parameters<Parameters<typeof observeFunnel>[1]>[0] = () => {};
  const emit = vi.fn();
  const count = vi.fn();
  observeFunnel(
    initial,
    (next) => {
      listener = next;
      return () => {};
    },
    emit,
    count,
  );
  const entry = { label: "private label", before: initial.project, after: initial.project, at: 1 };
  const edited = { ...initial, history: { past: [entry], future: [] } };
  listener(edited, initial);
  const undone = { ...initial, history: { past: [], future: [entry] } };
  listener(undone, edited);
  listener(edited, undone); // redo reuses the exact future entry
  listener(undone, edited);
  const fresh = { ...initial, history: { past: [{ ...entry, at: 2 }], future: [] } };
  listener(fresh, undone);
  listener(initial, fresh);
  expect(count.mock.calls.filter((call) => call[1] === "commands")).toHaveLength(2);
  expect(emit.mock.calls.some((call) => call[1].event === "command")).toBe(false);
  expect(count.mock.calls.filter((call) => call[1] === "undos")).toHaveLength(2);
  expect(JSON.stringify(emit.mock.calls)).not.toContain("private label");
});

it("unmount drains accepted export success instead of discarding pending hashing", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("localStorage", { getItem: () => "1", setItem: () => {} });
  const cleanup = mountFunnel();
  const episode = recordExport(useProjectStore.getState().project.id);
  episode.record("success");
  episode.finish();
  cleanup();
  await settleFunnelCollection();
  expect(
    vi
      .mocked(appendFunnelRow)
      .mock.calls.filter(([row]) => (row as { event: string }).event === "export-success"),
  ).toHaveLength(1);
});
it("pagehide and hidden visibility flush without opt-out", async () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", { getItem: () => "1", setItem: () => {} });
  const cleanup = mountFunnel();
  const episode = recordExport(useProjectStore.getState().project.id);
  episode.record("cancelled");
  episode.finish();
  win.dispatchEvent(new Event("pagehide"));
  doc.dispatchEvent(new Event("visibilitychange"));
  await settleFunnelCollection();
  expect(
    vi
      .mocked(appendFunnelRow)
      .mock.calls.some(([row]) => (row as { event: string }).event === "export-failure"),
  ).toBe(true);
  cleanup();
});
it("1000 history commands become one activity delta on flush", async () => {
  setFunnelEnabled(true);
  const initial = useProjectStore.getState();
  for (let n = 0; n < 1000; n++) {
    useProjectStore.setState({
      history: {
        past: [{ label: "synthetic", before: initial.project, after: initial.project, at: n }],
        future: [],
      },
    });
  }
  await settleFunnelCollection();
  const events = vi
    .mocked(appendFunnelRow)
    .mock.calls.map(([row]) => row as { event: string; data: unknown });
  expect(events.filter((row) => row.event === "activity")).toEqual([
    expect.objectContaining({ data: { commands: 1000, undos: 0 } }),
  ]);
  expect(events.some((row) => row.event === "command" || row.event === "undo")).toBe(false);
});
