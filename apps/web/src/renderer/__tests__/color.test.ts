import { listEffects } from "@/effects/registry";
import { describe, expect, it } from "vitest";
import { decodeTransfer, encodeTransfer, lutDomain } from "../color";

describe("SDR color contract", () => {
  it("round trips transfer functions including their piecewise joins", () => {
    for (const domain of ["srgb", "bt709", "linear"] as const) {
      let error = 0;
      for (let i = 0; i <= 65535; i++) {
        const x = i / 65535;
        error = Math.max(error, Math.abs(encodeTransfer(decodeTransfer(x, domain), domain) - x));
      }
      // The rounded BT.709 constants have a small discontinuity at 0.081.
      expect(error).toBeLessThan(domain === "bt709" ? 0.00025 : 1e-7);
    }
  });
  it("defines +1EV as twice the linear signal and retains highlights", () => {
    expect(decodeTransfer(encodeTransfer(0.18 * 2, "srgb"), "srgb")).toBeCloseTo(0.36, 12);
    expect(decodeTransfer(encodeTransfer(4, "srgb"), "srgb")).toBeCloseTo(4, 12);
  });
  it("declares every visual effect domain and leaves audio outside the contract", () => {
    const linear = new Set([
      "exposure",
      "white-balance",
      "color-wheels",
      "gaussian-blur",
      "sharpen",
      "grain",
      "vignette",
      "bg-remove",
    ]);
    for (const def of listEffects()) {
      if (def.category === "audio") expect(def.workingSpace).toBeUndefined();
      else expect(def.workingSpace).toBe(linear.has(def.type) ? "linear" : "encoded");
    }
  });
  it("defaults old LUTs to visible sRGB interpretation and rejects unsupported spaces", () => {
    expect(lutDomain(undefined)).toBe("srgb");
    expect(lutDomain("bt709")).toBe("bt709");
    expect(lutDomain("linear")).toBe("linear");
    expect(() => lutDomain("log-c")).toThrow("Unsupported LUT color space");
  });
});
