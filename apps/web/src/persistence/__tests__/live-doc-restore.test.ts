import { createEmptyProject } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createProjectCrdt } from "../project-crdt";
import { useProjectStore } from "@/stores/project-store";

const provider = vi.hoisted(() => ({ doc: null as Y.Doc | null, sync: () => {} }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced: Promise<void>;
    constructor(_name: string, doc: Y.Doc) {
      provider.doc = doc;
      this.whenSynced = new Promise((resolve) => {
        provider.sync = resolve;
      });
    }
    on() {}
    destroy() {}
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
