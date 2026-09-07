import { createEmptyProject, findTimeline, newId, toLegacyProject } from "@movie-desk/core";
import { beforeEach, expect, it, vi } from "vitest";
import { loadStoredProject, upsertProject } from "../project-library";

const rows = new Map<string, { id: string; name: string; updatedAt: number; json: string }>();
vi.mock("dexie", () => ({
  default: class {
    projects: unknown;
    version() {
      return {
        stores: () => {
          this.projects = {
            put: async (row: { id: string; name: string; updatedAt: number; json: string }) =>
              rows.set(row.id, row),
            get: async (id: string) => rows.get(id),
          };
        },
      };
    }
  },
}));
beforeEach(() => rows.clear());

it("keeps library JSON v1 while deriving the root alias on every load", async () => {
  const project = createEmptyProject({ name: "Saved film" });
  const legacy = toLegacyProject(project);
  rows.set(project.id, {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    json: JSON.stringify(legacy),
  });
  const loaded = await loadStoredProject(project.id);
  expect(loaded.status).toBe("ok");
  if (loaded.status !== "ok") throw new Error("Expected legacy project to load");
  expect(loaded.project).toEqual(project);
  expect(findTimeline(loaded.project, loaded.project.rootTimelineId)).toBe(loaded.project.timeline);
  await upsertProject(loaded.project);
  expect(JSON.parse(rows.get(project.id)!.json)).toEqual(legacy);
  expect(await loadStoredProject(project.id)).toEqual(loaded);
});

it("does not overwrite an existing library row with unsupported nested data", async () => {
  const base = createEmptyProject();
  await upsertProject(base);
  const before = rows.get(base.id)!.json;
  const nested = createEmptyProject({
    ...base,
    timelines: [base.timeline, { ...base.timeline, id: newId() }],
  });
  await expect(upsertProject(nested)).rejects.toThrow();
  expect(rows.get(base.id)!.json).toBe(before);
});
