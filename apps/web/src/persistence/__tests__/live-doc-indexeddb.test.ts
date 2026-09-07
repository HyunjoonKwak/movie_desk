import "fake-indexeddb/auto";
import { useProjectStore } from "@/stores/project-store";
import { createEmptyProject, type Project } from "@movie-desk/core";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { installCheckedWriter } from "../checked-indexeddb";
import { projectWritesBlocked } from "../hydration-state";
import { disposeLiveDoc, getLiveDoc, projectPersistenceName } from "../live-doc";
import { createProjectCrdt } from "../project-crdt";
import { loadStoredProject, upsertProject } from "../project-library";
import { useSaveStateStore } from "../save-state-store";
import { nestedProject } from "./fixtures/nested-project";

const seed = async (p: Project, change: (doc: Y.Doc) => void) => {
  const doc = new Y.Doc();
  const provider = new IndexeddbPersistence(projectPersistenceName(p.id), doc);
  const saved = vi.fn();
  installCheckedWriter(provider, {
    saved,
    failed: (error) => {
      throw error;
    },
    cleanup: vi.fn(),
  });
  await provider.whenSynced;
  doc.transact(() => {
    createProjectCrdt(doc).write(p);
    change(doc);
  });
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  await provider.destroy();
  doc.destroy();
};
const reopen = async (p: Project) => {
  const doc = new Y.Doc();
  const provider = new IndexeddbPersistence(projectPersistenceName(p.id), doc);
  await provider.whenSynced;
  const result = createProjectCrdt(doc).read(p.id, p.timeline);
  await provider.destroy();
  doc.destroy();
  return result;
};
afterEach(() => {
  disposeLiveDoc();
  vi.restoreAllMocks();
});

it("hydrates recovered order with each notice once and durably saves through the real live writer", async () => {
  const p = nestedProject();
  await seed(p, (doc) => doc.getArray("timeline-order-v3").delete(1, 1));
  const warning = vi.spyOn(toast, "warning");
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  await vi.waitFor(() => expect(projectWritesBlocked(p.id)).toBe(false));
  expect(warning).toHaveBeenCalledTimes(2);
  expect(useProjectStore.getState().project.timelines).toHaveLength(2);
  useProjectStore.getState().renameProject("Saved recovered child");
  await vi.waitFor(() => expect(useSaveStateStore.getState().state).toBe("saved"));
  expect(warning).toHaveBeenCalledTimes(2);
  disposeLiveDoc();
  const result = await reopen(p);
  expect(result?.name).toBe("Saved recovered child");
  expect(result?.timelines[1]).toEqual(p.timelines[1]);
});

it("retries a real writer quota failure while idle and reopens the failed edit", async () => {
  const p = createEmptyProject();
  await seed(p, () => {});
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  await vi.waitFor(() => expect(projectWritesBlocked(p.id)).toBe(false));
  const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementationOnce(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  useProjectStore.getState().renameProject("Idle retry survives");
  expect(useSaveStateStore.getState().documentError).toBe(true);
  add.mockRestore();
  await vi.waitFor(() => expect(useSaveStateStore.getState().documentError).toBe(false), {
    timeout: 4000,
  });
  disposeLiveDoc();
  expect((await reopen(p))?.name).toBe("Idle retry survives");
});

it("offers a library recovery copy on invalid metadata and preserves the damaged source", async () => {
  const p = createEmptyProject({ name: "Library fallback" });
  await upsertProject(p);
  await seed(p, (doc) => doc.getMap("project-meta").set("framerate", -1));
  const error = vi.spyOn(toast, "error");
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  expect(projectWritesBlocked(p.id)).toBe(true);
  const options = error.mock.calls.find((call) => call[1]?.id === `hydrate-failed:${p.id}`)?.[1];
  const action = options?.action as import("sonner").Action;
  expect(action).toBeDefined();
  action.onClick({} as Parameters<typeof action.onClick>[0]);
  await vi.waitFor(() => expect(useProjectStore.getState().project.id).not.toBe(p.id));
  const copy = useProjectStore.getState().project;
  await vi.waitFor(() => expect(projectWritesBlocked(copy.id)).toBe(false));
  useProjectStore.getState().renameProject("Recovery editable");
  await vi.waitFor(() => expect(useSaveStateStore.getState().state).toBe("saved"));
  expect(await loadStoredProject(p.id)).toMatchObject({ status: "ok", project: { name: p.name } });
  disposeLiveDoc();
  expect((await reopen(copy))?.name).toBe("Recovery editable");
  const original = new Y.Doc();
  const provider = new IndexeddbPersistence(projectPersistenceName(p.id), original);
  await provider.whenSynced;
  expect(original.getMap("project-meta").get("framerate")).toBe(-1);
  await provider.destroy();
  original.destroy();
});

it("reports the unplaced clip count once through live hydration", async () => {
  const p = nestedProject();
  const child = p.timelines[1]!;
  await seed(p, (doc) => {
    const order = doc.getArray(
      `timeline-clip-order-v3:${JSON.stringify([child.id, child.tracks[0]!.id])}`,
    );
    order.delete(0, order.length);
  });
  const warning = vi.spyOn(toast, "warning");
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  await vi.waitFor(() =>
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("1"), {
      id: `clipsPreserved:${p.id}`,
    }),
  );
  useProjectStore.getState().renameProject("Preserved with count");
  await vi.waitFor(() => expect(useSaveStateStore.getState().state).toBe("saved"));
  expect(warning).toHaveBeenCalledTimes(1);
});
