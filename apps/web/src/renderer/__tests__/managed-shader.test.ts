import { describe, expect, it } from "vitest";
import { managedShader, replaceOnce } from "../managed-shader";
import { SHADERS } from "../shader-registry";

describe("managed shader contracts", () => {
  for (const [name, source] of Object.entries(SHADERS)) {
    it(`transforms registered ${name}`, () => {
      const managed = managedShader(name, source);
      expect(managed).toContain("precision highp float;");
      expect(managed.match(/void main\(\)/g)).toHaveLength(1);
    });
  }
  it("rejects missing and ambiguous replacements", () => {
    expect(() => replaceOnce("changed", "original", "new")).toThrow("exactly one");
    expect(() => replaceOnce("old old", "old", "new")).toThrow("exactly one");
    expect(() =>
      managedShader("exposure", SHADERS.exposure!.replace("c.rgb * pow", "c.rgb*pow")),
    ).toThrow("exactly one");
  });
  it("sharpens premultiplied color and coverage together", () => {
    const shader = managedShader("sharpen", SHADERS.sharpen!);
    expect(shader).toContain("vec4 sharp = c *");
    expect(shader).not.toContain("straightSample");
    expect(shader).toContain("sharp.a > 0.0");
  });
});
