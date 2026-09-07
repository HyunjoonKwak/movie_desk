import { expect, it } from "vitest";
import { decodeTransfer, encodeTransfer } from "../color";
import { PROBE_RGB, classifyTransferProbe, uploadedVideoDomain } from "../input-color";
it("selects BT.709 inverse transfer when upload preserves encoded samples", () => {
  const result = classifyTransferProbe(PROBE_RGB);
  expect(result).toBe("preserved");
  expect(uploadedVideoDomain({ primaries: "bt709", transfer: "bt709" }, result)).toEqual({
    domain: "bt709",
    approximate: false,
  });
});
it("does not apply BT.709 twice when upload converts to sRGB", () => {
  const rgb = PROBE_RGB.map((x) =>
    Math.round(255 * encodeTransfer(decodeTransfer(x / 255, "bt709"), "srgb")),
  );
  const result = classifyTransferProbe(rgb);
  expect(result).toBe("converted-to-srgb");
  expect(uploadedVideoDomain({ primaries: "bt709", transfer: "bt709" }, result)).toEqual({
    domain: "srgb",
    approximate: false,
  });
});
it("marks probe failure and unrecognized tags as explicit SDR approximations", () => {
  for (const pixels of [[], [0, 0, 0], [Number.NaN, 100, 60]])
    expect(classifyTransferProbe(pixels)).toBe("unknown");
  expect(uploadedVideoDomain({ primaries: "bt709", transfer: "bt709" }, "unknown")).toEqual({
    domain: "srgb",
    approximate: true,
  });
  expect(uploadedVideoDomain({}, "preserved").approximate).toBe(true);
});
