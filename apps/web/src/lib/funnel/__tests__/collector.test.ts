import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, type MediaAsset } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import {
  observeFunnel,
  recordFunnel,
  setFunnelEnabled,
  settleFunnelCollection,
} from "../collector";
vi.mock("@/persistence/funnel-log", () => ({
  appendFunnelRow: vi.fn(),
  discardFunnelQueue: vi.fn(),
}));
import { appendFunnelRow } from "@/persistence/funnel-log";
afterEach(() => {
  setFunnelEnabled(false);
  vi.clearAllMocks();
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
  observeFunnel(
    initial,
    (next) => {
      listener = next;
      return () => {};
    },
    emit,
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
  expect(emit.mock.calls.filter((call) => call[1].event === "command")).toHaveLength(2);
  expect(emit.mock.calls.filter((call) => call[1].event === "undo")).toHaveLength(2);
  expect(JSON.stringify(emit.mock.calls)).not.toContain("private label");
});
