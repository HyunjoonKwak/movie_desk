import "fake-indexeddb/auto";
import { createEmptyProject, toLegacyProject } from "@movie-desk/core";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { insertRecoveredProject, listProjectsLibrary } from "../project-library";

it("lists a CRDT recovery immediately but never replaces an existing legacy row", async () => {
  const p = createEmptyProject({ name: "Recovered" });
  await insertRecoveredProject(p);
  expect(await listProjectsLibrary()).toContainEqual(
    expect.objectContaining({ id: p.id, name: p.name }),
  );
  const legacy = createEmptyProject({ name: "Legacy original" });
  const database = new Dexie("cut_editor.library.v1");
  database.version(1).stores({ projects: "id, updatedAt, name", meta: "key" });
  const original = JSON.stringify(toLegacyProject(legacy));
  await database
    .table("projects")
    .put({ id: legacy.id, name: legacy.name, updatedAt: legacy.updatedAt, json: original });
  await insertRecoveredProject({ ...legacy, name: "Must not replace" });
  expect((await database.table("projects").get(legacy.id)).json).toBe(original);
  database.close();
});
