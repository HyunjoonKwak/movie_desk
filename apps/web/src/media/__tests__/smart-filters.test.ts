import type { ID } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../search";
import { filtersFromSpec, filtersToSpec } from "../smart-filters";

describe("smart filter specs", () => {
  it("round-trips filters without the membership filter", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      tags: ["sea"],
      minRating: 3 as const,
      collection: "c1" as ID,
    };
    const spec = filtersToSpec(filters);
    expect(spec).not.toHaveProperty("collection");
    expect(filtersFromSpec(spec)).toEqual({ ...filters, collection: null });
  });

  it("falls back per field on unknown or malformed values", () => {
    expect(
      filtersFromSpec({
        kind: "hologram",
        minRating: 9,
        tags: "not-a-list",
        favorite: true,
        future: "ignored",
      }),
    ).toEqual({ ...DEFAULT_FILTERS, favorite: true });
  });
});
