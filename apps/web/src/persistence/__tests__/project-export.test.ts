import { describe, expect, it } from "vitest";
import { createEmptyProject, newId } from "@movie-desk/core";
import { parseProjectExport, parseStoredProject, toProjectExport } from "../project-export";

// The JSON export is the user's escape hatch for their work — a lossy or
// crash-prone round-trip is silent data loss. These guard both directions.
describe("project-export", () => {
  it("survives serialize → JSON → parse with no loss", () => {
    const project = createEmptyProject({ name: "My Film" });
    const json = JSON.stringify(toProjectExport(project));
    const parsed = parseProjectExport(JSON.parse(json));
    expect(parsed.schema).toBe("cut_editor-project");
    expect(parsed.project).toEqual(project);
  });

  it("preserves customized resolution, framerate, and nested tracks", () => {
    const project = createEmptyProject({
      name: "4K 24p",
      framerate: 24,
      resolution: { w: 3840, h: 2160 },
    });
    const parsed = parseProjectExport(JSON.parse(JSON.stringify(toProjectExport(project))));
    expect(parsed.project.framerate).toBe(24);
    expect(parsed.project.resolution).toEqual({ w: 3840, h: 2160 });
    // createEmptyProject seeds a V1 + A1 track pair; both must round-trip.
    expect(parsed.project.timeline.tracks).toHaveLength(2);
    expect(parsed.project.timeline.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
  });

  it("stamps a numeric version and export timestamp", () => {
    const exported = toProjectExport(createEmptyProject());
    expect(typeof exported.version).toBe("number");
    expect(exported.exportedAt).toBeGreaterThan(0);
  });

  it("rejects a payload with the wrong schema tag", () => {
    expect(() =>
      parseProjectExport({ schema: "definitely-not-us", version: 1, exportedAt: 0, project: {} }),
    ).toThrow();
  });

  it("rejects non-object payloads", () => {
    expect(() => parseProjectExport(null)).toThrow();
    expect(() => parseProjectExport("not json")).toThrow();
    expect(() => parseProjectExport(42)).toThrow();
  });

  it("rejects a project whose clips are missing core fields", () => {
    const good = toProjectExport(createEmptyProject());
    const corrupt = {
      ...good,
      project: {
        ...good.project,
        timeline: {
          ...good.project.timeline,
          tracks: [{ id: "t", kind: "video", clips: [{ nonsense: true }] }],
        },
      },
    };
    expect(() => parseProjectExport(corrupt)).toThrow();
  });

  it("rejects a media asset missing its opfsPath", () => {
    const good = toProjectExport(createEmptyProject());
    const corrupt = {
      ...good,
      project: {
        ...good.project,
        mediaLibrary: [{ id: "a", name: "x", kind: "video", mime: "video/mp4", durationMs: 1 }],
      },
    };
    expect(() => parseProjectExport(corrupt)).toThrow();
  });

  it("rejects a file written by a newer app version", () => {
    const env = toProjectExport(createEmptyProject());
    expect(() => parseProjectExport({ ...env, version: env.version + 1 })).toThrow();
  });

  it("rejects an older version until an explicit migration exists", () => {
    const env = toProjectExport(createEmptyProject());
    expect(() => parseProjectExport({ ...env, version: 0 })).toThrow(/older format/);
  });

  it("rejects unknown discriminants and incomplete tracks", () => {
    const good = toProjectExport(createEmptyProject());
    const track = good.project.timeline.tracks[0];
    expect(track).toBeDefined();
    const corrupt = {
      ...good,
      project: {
        ...good.project,
        timeline: {
          ...good.project.timeline,
          tracks: [{ ...track, kind: "mystery", locked: undefined }],
        },
      },
    };
    expect(() => parseProjectExport(corrupt)).toThrow();
  });

  it("validates stored library projects and preserves timeline markers", () => {
    const project = createEmptyProject({
      timeline: {
        ...createEmptyProject().timeline,
        markers: [{ id: newId(), at: 250, label: "Beat", color: "#ff0000" }],
      },
    });

    expect(parseStoredProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("rejects malformed stored library projects before they reach the editor", () => {
    const project = createEmptyProject();
    expect(() =>
      parseStoredProject({
        ...project,
        timeline: { ...project.timeline, tracks: "not-an-array" },
      }),
    ).toThrow();
  });
});
