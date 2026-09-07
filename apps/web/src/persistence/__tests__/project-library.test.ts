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

it("migrates v1 in memory and writes v2 only on explicit save", async () => {
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
  expect(JSON.parse(rows.get(project.id)!.json)).toEqual(legacy);
  await upsertProject({ ...loaded.project, name: "Edited" });
  expect(JSON.parse(rows.get(project.id)!.json).timelines).toEqual(project.timelines);
  expect(await loadStoredProject(project.id)).toMatchObject({
    status: "ok",
    project: { name: "Edited" },
  });
});

it("does not overwrite an existing library row with malformed nested data", async () => {
  const base = createEmptyProject();
  await upsertProject(base);
  const before = rows.get(base.id)!.json;
  const nested = createEmptyProject({
    ...base,
    timelines: [base.timeline, { ...base.timeline, id: newId() }],
  });
  await expect(
    upsertProject({ ...nested, timelines: [...nested.timelines, nested.timeline] }),
  ).rejects.toThrow();
  expect(rows.get(base.id)!.json).toBe(before);
});

it("self-heals a stale root collection and saves the latest alias with current wire keys", async () => {
  const base = createEmptyProject();
  const edited = { ...base, timeline: { ...base.timeline, playhead: 123, zoom: 0.5 } };
  expect(edited.timelines[0]).not.toBe(edited.timeline);
  await upsertProject(edited);
  const raw = JSON.parse(rows.get(base.id)!.json);
  expect(raw.timeline.playhead).toBe(123);
  expect(raw.timeline.zoom).toBe(0.5);
  expect(raw).toHaveProperty("timelines");
  expect(raw).toHaveProperty("rootTimelineId");
  expect(raw.timeline).toHaveProperty("id");
  const loaded = await loadStoredProject(base.id);
  if (loaded.status !== "ok") throw new Error("Expected saved edit");
  expect(loaded.project.timeline).toBe(loaded.project.timelines[0]);
  expect(loaded.project.timeline.playhead).toBe(123);
});

it("keeps a failed migration row byte-for-byte and returns its reason", async () => {
  const p = createEmptyProject();
  const raw = JSON.stringify({ ...p, timelines: null });
  const row = { id: p.id, name: p.name, updatedAt: 0, json: raw };
  rows.set(p.id, row);
  expect(await loadStoredProject(p.id)).toMatchObject({
    status: "corrupt",
    raw,
    reason: expect.stringContaining("original data is unchanged"),
  });
  expect(rows.get(p.id)).toBe(row);
});

it("round-trips nested child edits through the actual library API", async () => {
  const { nestedProject } = await import("./fixtures/nested-project");
  const p = nestedProject();
  await upsertProject(p);
  const loaded = await loadStoredProject(p.id);
  expect(loaded).toEqual({ status: "ok", project: p });
  if (loaded.status !== "ok") throw new Error("Expected project");
  await upsertProject({ ...loaded.project, name: "Edited" });
  expect(await loadStoredProject(p.id)).toMatchObject({
    status: "ok",
    project: { timelines: p.timelines, name: "Edited" },
  });
});
