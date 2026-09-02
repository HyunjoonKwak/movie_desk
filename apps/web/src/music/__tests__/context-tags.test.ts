import { describe, expect, it } from "vitest";
import { createEmptyProject, type ID } from "@movie-desk/core";
import { projectContextText, suggestTagsFromText } from "../context-tags";

describe("suggestTagsFromText", () => {
  it("returns tags that appear in the project text, case-insensitively", () => {
    const text = "제주 여행 브이로그\n오프닝 인사\nCalm sunset";

    expect(suggestTagsFromText(text, ["여행", "오프닝", "신나는", "calm"])).toEqual([
      "여행",
      "오프닝",
      "calm",
    ]);
  });

  it("ignores single-character tags to avoid noise", () => {
    expect(suggestTagsFromText("a b c", ["a", "ab"])).toEqual([]);
  });
});

describe("projectContextText", () => {
  it("collects the project name and marker labels", () => {
    const p0 = createEmptyProject();
    const p = {
      ...p0,
      name: "제주 여행",
      timeline: {
        ...p0.timeline,
        markers: [{ id: "m1" as ID, at: 0, label: "오프닝", color: "#fff" }],
      },
    };

    const text = projectContextText(p);

    expect(text).toContain("제주 여행");
    expect(text).toContain("오프닝");
  });
});
