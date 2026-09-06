import { describe, expect, it } from "vitest";
import { chapterExportLines } from "../chapter-export";

describe("chapter export", () => {
  it("uses whole wall-clock seconds at minute/hour boundaries, never FF", () => {
    expect(
      chapterExportLines(
        [
          { at: 3_661_999, label: "Hour" },
          { at: 59_999, label: "Minute" },
          { at: 60_000, label: "Next" },
          { at: 1234, label: "" },
        ],
        "Intro",
        "Untitled",
      ),
    ).toEqual(["0:00 Intro", "0:01 Untitled", "0:59 Minute", "1:00 Next", "1:01:01 Hour"]);
  });
  it("keeps the existing zero chapter instead of prepending a duplicate", () => {
    expect(chapterExportLines([{ at: 0, label: "Start" }], "Intro", "Untitled")).toEqual([
      "0:00 Start",
    ]);
  });
  it("provides an introduction for an empty marker list", () => {
    expect(chapterExportLines([], "시작", "이름 없음")).toEqual(["0:00 시작"]);
  });
});
