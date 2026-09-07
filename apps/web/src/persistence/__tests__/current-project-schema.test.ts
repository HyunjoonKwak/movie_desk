import { NestedTimelineError } from "@movie-desk/core";
import { expect, it } from "vitest";
import { parseCurrentProject } from "../project-export";
import { nestedProject } from "./fixtures/nested-project";

it("validates the complete v2 shape and derives its root alias", () => {
  const project = nestedProject();
  const parsed = parseCurrentProject(JSON.parse(JSON.stringify(project)));
  expect(parsed).toEqual(project);
  expect(parsed.timeline).toBe(parsed.timelines[0]);
});

it("rejects a CRDT candidate that omits both nested fields", () => {
  const { timelines: _timelines, rootTimelineId: _root, ...candidate } = nestedProject();
  expect(() => parseCurrentProject(candidate)).toThrow(NestedTimelineError);
});

it("fails on incomplete children without dropping their data", () => {
  const project = nestedProject();
  const candidate = { ...project, timelines: [project.timeline, { id: "child" }] };
  const before = JSON.stringify(candidate);
  expect(() => parseCurrentProject(candidate)).toThrow(NestedTimelineError);
  expect(JSON.stringify(candidate)).toBe(before);
});
