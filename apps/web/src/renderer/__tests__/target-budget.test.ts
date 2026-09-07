import { expect, it } from "vitest";
import { IMAGE_TARGET_BYTES, MAX_SOURCE_TARGET_BYTES, SOURCE_TARGET_BYTES } from "../target-budget";

it("reserves a 4K RGBA16F project target alongside the largest allowed source", () => {
  const projectTargetBytes = 3840 * 2160 * 8;
  expect(MAX_SOURCE_TARGET_BYTES + projectTargetBytes).toBeLessThanOrEqual(SOURCE_TARGET_BYTES);
});

it("holds three native 4K RGBA16F stills in the independent image cache", () => {
  expect(3 * 3840 * 2160 * 8).toBeLessThanOrEqual(IMAGE_TARGET_BYTES);
});
