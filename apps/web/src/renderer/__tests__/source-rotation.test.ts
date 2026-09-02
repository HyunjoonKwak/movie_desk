import { describe, expect, it } from "vitest";
import { quarterTurns, rotateImageUv } from "../source-rotation";

// Image coordinates: u to the right, v downward, both in [0,1]. The mapping
// answers "which source texel does output pixel (u,v) show" for a clockwise
// display rotation — the same maths the rotate shader runs.
describe("rotateImageUv", () => {
  it("maps corners for 90° clockwise: the source's top-left ends up top-right", () => {
    expect(rotateImageUv(1, 0, 1)).toEqual([0, 0]);
    expect(rotateImageUv(1, 1, 1)).toEqual([1, 0]);
    expect(rotateImageUv(0, 0, 1)).toEqual([0, 1]);
  });

  it("maps 180° and 270°", () => {
    expect(rotateImageUv(0, 0, 2)).toEqual([1, 1]);
    expect(rotateImageUv(0, 1, 3)).toEqual([0, 0]); // 270 cw = 90 ccw: top-left → bottom-left
    expect(rotateImageUv(0.25, 0.5, 0)).toEqual([0.25, 0.5]);
  });

  it("converts degrees to quarter turns", () => {
    expect(quarterTurns(0)).toBe(0);
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(180)).toBe(2);
    expect(quarterTurns(270)).toBe(3);
  });
});
