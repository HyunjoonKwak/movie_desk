import { describe, expect, it } from "vitest";
import { BLEND_MODES, isBackdropBlend } from "@movie-desk/core";
import { BACKDROP_BLEND_MODE } from "../compositor-uniforms";
import { MASK_FN, MASK_UNIFORMS, WIPE_FN, WIPE_UNIFORMS } from "../shaders/common";
import { fs as blendModesFs } from "../shaders/blend-modes";
import { fs as blitFs } from "../shaders/blit";

// There is no compiler between the TypeScript mode table and the GLSL switch it
// indexes, and the shader only fails at link time in a real GL context — which
// these node-environment tests do not have. Matching the table against the
// shader source is the cheap defence that catches a mode added on one side
// only. Pixel correctness is out of reach here; that needs a Playwright run.
describe("backdrop blend mode table", () => {
  const backdropModes = BLEND_MODES.filter((m) => isBackdropBlend(m));

  it("has an entry for every backdrop-reading mode", () => {
    expect(Object.keys(BACKDROP_BLEND_MODE).sort()).toEqual([...backdropModes].sort());
  });

  it("assigns each mode a distinct integer", () => {
    const values = Object.values(BACKDROP_BLEND_MODE);
    expect(new Set(values).size).toBe(values.length);
  });

  it("assigns a contiguous range starting at 0", () => {
    const values = Object.values(BACKDROP_BLEND_MODE).sort((a, b) => a - b);
    expect(values).toEqual(values.map((_, i) => i));
  });

  it("keeps overlay and soft-light on their original values", () => {
    // Not load-bearing across sessions (u_mode is never persisted), but keeping
    // them pinned makes an accidental renumbering visible in review.
    expect(BACKDROP_BLEND_MODE.overlay).toBe(0);
    expect(BACKDROP_BLEND_MODE["soft-light"]).toBe(1);
  });
});

describe("blend-modes shader source", () => {
  it("branches on every integer the mode table can produce", () => {
    for (const [mode, value] of Object.entries(BACKDROP_BLEND_MODE)) {
      const branch = new RegExp(`u_mode\\s*==\\s*${value}\\b`);
      expect(branch.test(blendModesFs), `missing GLSL case ${value} for "${mode}"`).toBe(
        true,
      );
    }
  });

  it("does not branch on integers outside the mode table", () => {
    const cases = [...blendModesFs.matchAll(/u_mode\s*==\s*(\d+)\b/g)].map((m) =>
      Number(m[1]),
    );
    const declared = new Set<number>(Object.values(BACKDROP_BLEND_MODE));
    // u_wipe_mode comparisons are a different uniform and must not be caught.
    for (const c of cases) {
      expect(declared.has(c), `GLSL branches on undeclared mode ${c}`).toBe(true);
    }
  });

  it("unpremultiplies the foreground before blending", () => {
    // Blend maths is defined on straight colour. Feeding premultiplied rgb in
    // skews every mode wherever alpha < 1 (text edges, feathered masks).
    expect(blendModesFs).toMatch(/fg\.rgb\s*\/\s*fg\.a/);
  });

  it("uses highp so the dodge/burn divisions resolve near their singularity", () => {
    expect(blendModesFs).toMatch(/precision\s+highp\s+float/);
  });

  it("honours the wipe transition like the blit path does", () => {
    // The backdrop path used to ignore wipes entirely: the uniforms were never
    // declared, so a wiping clip with a backdrop blend mode simply popped in.
    expect(blendModesFs).toMatch(/uniform\s+int\s+u_wipe_mode/);
    expect(blendModesFs).toMatch(/wipeMask\(v_uv\)/);
  });
});

describe("shared composite chunks", () => {
  // Both paths draw the same mask and the same wipe for the same clip. They
  // diverged once — one compared squared distance, the other linear — so an
  // identical ellipse mask rendered differently depending on the clip's blend
  // mode. Asserting both sources embed the shared chunk verbatim is what keeps
  // a future edit to one file from silently forking the other.
  const chunks: ReadonlyArray<[string, string]> = [
    ["vector mask", MASK_FN],
    ["wipe mask", WIPE_FN],
    ["mask uniforms", MASK_UNIFORMS],
    ["wipe uniforms", WIPE_UNIFORMS],
  ];

  for (const [name, chunk] of chunks) {
    it(`embeds the shared ${name} in both shaders exactly once`, () => {
      for (const [label, src] of [
        ["blit", blitFs],
        ["blend-modes", blendModesFs],
      ] as const) {
        expect(src.includes(chunk), `${label} is missing the shared ${name}`).toBe(true);
        expect(src.split(chunk).length - 1, `${label} duplicates the ${name}`).toBe(1);
      }
    });
  }

  it("uses linear distance for the ellipse feather", () => {
    // The squared-distance variant that used to live in the blend shader gave a
    // visibly different feather ramp for the same mask.
    expect(MASK_FN).toContain("length((uv - center) / rad)");
  });
});
