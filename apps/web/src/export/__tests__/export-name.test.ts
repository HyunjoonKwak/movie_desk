import { createCut, createEmptyProject, renameCut, switchCut } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { exportBaseName, sanitizeName } from "../export-name";

describe("export naming", () => {
  it("keeps letters of any script and collapses the rest", () => {
    expect(sanitizeName("가족 여행 2026/08")).toBe("가족_여행_2026_08");
    expect(sanitizeName("  Untitled  ")).toBe("Untitled");
    expect(sanitizeName("///")).toBe("");
  });
  it("names the file after the cut, then the project", () => {
    const one = { ...createEmptyProject(), name: "여행" };
    expect(exportBaseName(one)).toBe("여행");
    const { project: two, cutId } = createCut(one);
    expect(exportBaseName(two)).toBe("여행 2");
    expect(exportBaseName(switchCut(two, one.rootTimelineId))).toBe("여행 1");
    expect(exportBaseName(renameCut(two, cutId, "짧은 버전"))).toBe("짧은 버전");
  });
});
