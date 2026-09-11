import { createCut, createEmptyProject, listCuts } from "@movie-desk/core";
import { expect, it } from "vitest";
import { parseCurrentProject } from "../project-export";

it("keeps a second cut, its name and its role across the wire", () => {
  const { project } = createCut(createEmptyProject(), "짧은 버전");
  const parsed = parseCurrentProject(JSON.parse(JSON.stringify(project)));
  expect(parsed.rootTimelineId).toBe(project.rootTimelineId);
  expect(listCuts(parsed).map((cut) => [cut.id, cut.name, cut.role])).toEqual(
    listCuts(project).map((cut) => [cut.id, cut.name, cut.role]),
  );
});
