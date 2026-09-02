import type { SourceRotation } from "@movie-desk/core";

// Pure counterpart of shaders/rotate.ts so the mapping is unit-tested.
// Image coordinates (u right, v down, both in [0,1]); `turns` are clockwise
// quarter turns to apply to the decoded frame for display.

export const quarterTurns = (rotation: SourceRotation): 0 | 1 | 2 | 3 =>
  (rotation / 90) as 0 | 1 | 2 | 3;

// Which source texel output pixel (u, v) shows after `turns` clockwise turns.
export const rotateImageUv = (u: number, v: number, turns: number): [number, number] => {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return [v, 1 - u];
    case 2:
      return [1 - u, 1 - v];
    case 3:
      return [1 - v, u];
    default:
      return [u, v];
  }
};
