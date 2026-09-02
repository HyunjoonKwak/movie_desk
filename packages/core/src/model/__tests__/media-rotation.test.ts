import { describe, expect, it } from "vitest";
import { rotationFromMatrix } from "../media-rotation";

// tkhd matrices are 16.16 fixed point: [a b u c d v x y w]. The result is the
// clockwise angle a decoded (unrotated) frame must turn to display upright.
const F = 65536;

describe("rotationFromMatrix", () => {
  it("reads identity, iPhone portrait, upside-down and counter-clockwise matrices", () => {
    expect(rotationFromMatrix([F, 0, 0, 0, F, 0, 0, 0, 0x40000000])).toBe(0);
    expect(rotationFromMatrix([0, F, 0, -F, 0, 0, 0, 0, 0x40000000])).toBe(90); // iPhone portrait
    expect(rotationFromMatrix([-F, 0, 0, 0, -F, 0, 0, 0, 0x40000000])).toBe(180);
    expect(rotationFromMatrix([0, -F, 0, F, 0, 0, 0, 0, 0x40000000])).toBe(270); // ffmpeg -display_rotation 90
  });

  it("tolerates scaled matrices but rejects skew and degenerate ones", () => {
    expect(rotationFromMatrix([0, 2 * F, 0, -2 * F, 0, 0, 0, 0, 0x40000000])).toBe(90);
    expect(rotationFromMatrix([F, F, 0, -F, F, 0, 0, 0, 0x40000000])).toBeNull(); // 45°
    expect(rotationFromMatrix([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(rotationFromMatrix([])).toBeNull();
  });
});
