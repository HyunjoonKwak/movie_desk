import { useProjectStore } from "@/stores/project-store";
import { createEmptyProject } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";

const provider = vi.hoisted(() => ({ doc: null as Y.Doc | null, sync: () => {} }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    doc: Y.Doc;
    whenSynced: Promise<void>;
    constructor(_name: string, doc: Y.Doc) {
      this.doc = doc;
      provider.doc = doc;
      this.whenSynced = new Promise((resolve) => {
        provider.sync = resolve;
      });
    }
    on() {}
    destroy() {}
  },
}));
vi.mock("../checked-indexeddb", () => ({
  installCheckedWriter: (p: { doc: Y.Doc }, callbacks: { saved: () => void }) => {
    p.doc.on("update", () => queueMicrotask(callbacks.saved));
    return () => queueMicrotask(callbacks.saved);
  },
}));
import { disposeLiveDoc, getLiveDoc } from "../live-doc";

afterEach(() => {
  disposeLiveDoc();
  vi.restoreAllMocks();
});

it("applies one fully restored document and continues applying later remote edits", async () => {
  const project = createEmptyProject({ name: "library row" });
  useProjectStore.getState().loadProject(project);
  const load = vi.spyOn(useProjectStore.getState(), "loadProject");
  getLiveDoc();
  const doc = provider.doc as Y.Doc;
  const crdt = createProjectCrdt(doc);
  doc.transact(() => crdt.write({ ...project, name: "first update" }));
  doc.transact(() => crdt.write({ ...project, name: "latest update" }));
  expect(load).not.toHaveBeenCalled();
  provider.sync();
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  doc.transact(() => {});
  expect(load).toHaveBeenCalledTimes(1);
  expect(useProjectStore.getState().project.name).toBe("latest update");
  doc.transact(() => crdt.write({ ...project, name: "remote edit" }));
  expect(useProjectStore.getState().project.name).toBe("remote edit");
  expect(load).toHaveBeenCalledTimes(2);
});

it("blocks pre-sync edits and failed hydration writes while preserving the original document", async () => {
  const Y = await import("yjs");
  const { legacyCrdt } = await import("./fixtures/legacy-crdt");
  const { useSaveStateStore } = await import("../save-state-store");
  const project = createEmptyProject();
  useProjectStore.getState().loadProject(project);
  getLiveDoc();
  const legacy = legacyCrdt(project);
  legacy.getMap("project-meta").set("framerate", -1);
  Y.applyUpdate(provider.doc!, Y.encodeStateAsUpdate(legacy));
  const before = Y.encodeStateAsUpdate(provider.doc!);
  useProjectStore.getState().renameProject("Before sync");
  expect(Y.encodeStateAsUpdate(provider.doc!)).toEqual(before);
  provider.sync();
  await Promise.resolve();
  await Promise.resolve();
  expect(useSaveStateStore.getState().state).toBe("error");
  useSaveStateStore.getState().markSaved();
  useSaveStateStore.getState().setLibraryError(false);
  expect(useSaveStateStore.getState().state).toBe("error");
  useProjectStore.getState().renameProject("After failed sync");
  expect(useSaveStateStore.getState().state).toBe("error");
  expect(Y.encodeStateAsUpdate(provider.doc!)).toEqual(before);
  legacy.destroy();
});

it("hydrates nested state and flushes child-only edits through the live store", async () => {
  const { nestedProject } = await import("./fixtures/nested-project");
  const { replaceTimeline } = await import("@movie-desk/core");
  const p = nestedProject();
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  createProjectCrdt(provider.doc!).write(p);
  provider.sync();
  await Promise.resolve();
  const loaded = useProjectStore.getState().project;
  expect(loaded.timelines).toEqual(p.timelines);
  const child = loaded.timelines[1]!;
  const edited = replaceTimeline(loaded, { ...child, zoom: 0.5 });
  useProjectStore.setState({ project: edited });
  expect(createProjectCrdt(provider.doc!).read(p.id, p.timeline)?.timelines).toEqual(
    edited.timelines,
  );
});

it("keeps a freshly seeded project eligible for its initial library save", async () => {
  const { isRestoredProject } = await import("../hydration-state");
  const p = createEmptyProject();
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  provider.sync();
  await Promise.resolve();
  expect(useProjectStore.getState().project).toBe(p);
  expect(isRestoredProject(useProjectStore.getState().project)).toBe(false);
  expect(createProjectCrdt(provider.doc!).read(p.id, p.timeline)?.rootTimelineId).toBe(
    p.rootTimelineId,
  );
});

it("keeps preview maintenance after hydration out of the persisted CRDT until a user edit", async () => {
  const Y = await import("yjs");
  const p = createEmptyProject({
    mediaLibrary: [
      {
        id: "asset" as import("@movie-desk/core").ID,
        name: "Picture",
        kind: "image",
        mime: "image/png",
        durationMs: 0,
        opfsPath: "picture.png",
        importedAt: 0,
        thumbDataUrl: "data:image/png;base64,AA==",
      },
    ],
  });
  useProjectStore.getState().loadProject(p);
  getLiveDoc();
  createProjectCrdt(provider.doc!).write(p);
  provider.sync();
  await Promise.resolve();
  const before = Y.encodeStateAsUpdate(provider.doc!);
  useProjectStore.getState().dropInlinePreviews([p.mediaLibrary[0]!.id]);
  expect(Y.encodeStateAsUpdate(provider.doc!)).toEqual(before);
  useProjectStore.getState().renameProject("Actual edit");
  const reloaded = createProjectCrdt(provider.doc!).read(p.id, p.timeline)!;
  expect(reloaded.name).toBe("Actual edit");
  expect(reloaded.mediaLibrary[0]).not.toHaveProperty("thumbDataUrl");
});

it.each(["duration", "start", "id", "root"])(
  "contains invalid %s edits and resumes saving after correction",
  async (field) => {
    const Y = await import("yjs");
    const { nestedProject } = await import("./fixtures/nested-project");
    const { useSaveStateStore } = await import("../save-state-store");
    const p = nestedProject();
    useProjectStore.getState().loadProject(p);
    getLiveDoc();
    createProjectCrdt(provider.doc!).write(p);
    provider.sync();
    await Promise.resolve();
    await Promise.resolve();
    const good = useProjectStore.getState().project;
    const before = Y.encodeStateAsUpdate(provider.doc!);
    const bad = {
      ...good,
      timeline:
        field === "root"
          ? { ...good.timeline, id: "wrong" as typeof good.timeline.id }
          : {
              ...good.timeline,
              tracks: good.timeline.tracks.map((track, i) =>
                i
                  ? track
                  : {
                      ...track,
                      clips: track.clips.map((clip) => ({
                        ...clip,
                        [field]: field === "duration" ? 0 : field === "start" ? Number.NaN : "",
                      })),
                    },
              ),
            },
      name: "Transient edit",
    };
    expect(() => useProjectStore.setState({ project: bad })).not.toThrow();
    expect(Y.encodeStateAsUpdate(provider.doc!)).toEqual(before);
    expect(useSaveStateStore.getState().documentError).toBe(true);
    await Promise.resolve();
    expect(useSaveStateStore.getState().state).toBe("error");
    expect(() =>
      useProjectStore.setState({ project: { ...good, name: "Corrected" } }),
    ).not.toThrow();
    await Promise.resolve();
    expect(useSaveStateStore.getState().documentError).toBe(false);
    expect(createProjectCrdt(provider.doc!).read(p.id, p.timeline)?.name).toBe("Corrected");
  },
);
