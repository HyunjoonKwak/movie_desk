import type { ID } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { projectPersistenceName } from "../live-doc";

describe("projectPersistenceName", () => {
  it("isolates each local project in its own IndexedDB document", () => {
    expect(projectPersistenceName("project-a" as ID)).toBe("cut-editor:project:project-a");
    expect(projectPersistenceName("project-b" as ID)).not.toBe(
      projectPersistenceName("project-a" as ID),
    );
  });

  it("escapes ids before using them as database names", () => {
    expect(projectPersistenceName("folder/project" as ID)).toBe(
      "cut-editor:project:folder%2Fproject",
    );
  });
});
