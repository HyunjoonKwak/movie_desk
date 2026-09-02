import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "@movie-desk/core";
import { BLEND_GROUPS } from "../blend-groups";

// The picker renders from BLEND_GROUPS, not from BLEND_MODES, so a mode that is
// declared but ungrouped exists in the model and the shader yet cannot be
// chosen — the kind of gap nobody notices until someone asks where a mode went.
describe("blend mode picker groups", () => {
  const grouped = BLEND_GROUPS.flatMap((g) => g.modes);

  it("offers every declared blend mode", () => {
    const missing = BLEND_MODES.filter((m) => !grouped.includes(m));
    expect(missing, `ungrouped modes: ${missing.join(", ")}`).toEqual([]);
  });

  it("offers each mode exactly once", () => {
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.length).toBe(BLEND_MODES.length);
  });

  it("has no empty group", () => {
    for (const g of BLEND_GROUPS) expect(g.modes.length).toBeGreaterThan(0);
  });
});
