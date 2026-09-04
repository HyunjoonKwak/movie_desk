import { describe, expect, it } from "vitest";
import { hasTag, normalizeTag, parseTagInput, withTag, withoutTag } from "../tags";

describe("tags", () => {
  it("normalises input: trims, collapses spaces, drops the hash, caps length", () => {
    expect(normalizeTag("  #Sea   trip ")).toBe("Sea trip");
    expect(normalizeTag("###")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("x".repeat(60))).toHaveLength(40);
  });

  it("treats tags as case-insensitive but keeps the first spelling", () => {
    const tags = withTag(undefined, "Sea");
    expect(withTag(tags, "sea")).toBe(tags);
    expect(hasTag(tags, "SEA")).toBe(true);
    expect(withoutTag(tags, "SEA")).toEqual([]);
    expect(withTag(tags, "Trip")).toEqual(["Sea", "Trip"]);
  });

  it("parses comma-separated input and dedupes", () => {
    expect(parseTagInput("sea, Trip ,#SEA,, ")).toEqual(["sea", "Trip"]);
  });
});
