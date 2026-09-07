import { createEmptyProject } from "@movie-desk/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { startLibraryAutosave } from "../library-autosave";
import { upsertProject } from "../project-library";
import { useSaveStateStore } from "../save-state-store";

vi.mock("../project-library", () => ({ upsertProject: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useProjectStore.getState().loadProject(createEmptyProject());
  useSaveStateStore.setState({ state: "idle", libraryError: false, lastSavedAt: null });
  vi.mocked(upsertProject).mockRejectedValue(new Error("disk full"));
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

it("reports debounce failure and retries on the next edit without a stale saved badge", async () => {
  dispose = startLibraryAutosave();
  await vi.advanceTimersByTimeAsync(300);
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(useSaveStateStore.getState().state).toBe("error");
  useSaveStateStore.getState().markSaved(); // an independent Yjs flush must not hide it
  useSaveStateStore.getState().setState("saving");
  expect(useSaveStateStore.getState().state).toBe("error");
  vi.mocked(upsertProject).mockResolvedValue(undefined);
  useProjectStore.setState(({ project }) => ({ project: { ...project, name: "Retry" } }));
  await vi.advanceTimersByTimeAsync(300);
  expect(upsertProject).toHaveBeenCalledTimes(2);
  expect(vi.mocked(upsertProject).mock.calls[1]?.[0].name).toBe("Retry");
  expect(useSaveStateStore.getState().state).toBe("saved");
});

it("reports cleanup flush failure with the latest queued edits", async () => {
  dispose = startLibraryAutosave();
  useProjectStore.setState(({ project }) => ({ project: { ...project, name: "Last edit" } }));
  dispose();
  dispose = undefined;
  await vi.advanceTimersByTimeAsync(0);
  expect(upsertProject).toHaveBeenCalledTimes(1);
  expect(vi.mocked(upsertProject).mock.calls[0]?.[0].name).toBe("Last edit");
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(useSaveStateStore.getState().state).toBe("error");
  await vi.advanceTimersByTimeAsync(300);
  expect(upsertProject).toHaveBeenCalledTimes(1);
});

it("keeps the initial local-first state after a successful startup snapshot", async () => {
  vi.mocked(upsertProject).mockResolvedValue(undefined);
  dispose = startLibraryAutosave();
  await vi.advanceTimersByTimeAsync(300);
  expect(useSaveStateStore.getState()).toMatchObject({
    state: "idle",
    libraryError: false,
    lastSavedAt: null,
  });
});

it("does not let an older success clear a newer cleanup failure", async () => {
  let finishOld!: () => void;
  vi.mocked(upsertProject).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishOld = resolve;
      }),
  );
  dispose = startLibraryAutosave();
  await vi.advanceTimersByTimeAsync(300);
  useProjectStore.setState(({ project }) => ({ project: { ...project, name: "Newer" } }));
  dispose();
  dispose = undefined;
  await vi.advanceTimersByTimeAsync(0);
  expect(useSaveStateStore.getState().state).toBe("error");
  finishOld();
  await vi.advanceTimersByTimeAsync(0);
  expect(useSaveStateStore.getState().state).toBe("error");
  expect(toast.error).toHaveBeenCalledTimes(1);
});

it("ignores failures from writes older than the latest successful write", async () => {
  let failOld!: (error: Error) => void;
  vi.mocked(upsertProject)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOld = reject;
        }),
    )
    .mockResolvedValue(undefined);
  dispose = startLibraryAutosave();
  await vi.advanceTimersByTimeAsync(300);
  useProjectStore.setState(({ project }) => ({ project: { ...project, name: "Newer" } }));
  await vi.advanceTimersByTimeAsync(300);
  failOld(new Error("late failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(useSaveStateStore.getState().libraryError).toBe(false);
  expect(toast.error).not.toHaveBeenCalled();
});
