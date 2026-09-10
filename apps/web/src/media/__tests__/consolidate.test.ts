import { afterEach, expect, it, vi } from "vitest";
import {
  canConsolidate,
  consolidateAssets,
  consolidateRoot,
  parseConsolidateResult,
} from "../consolidate";

const bridge = (
  consolidate?: (ids: string[]) => Promise<unknown>,
  consolidateRootFn?: (rootId: string) => Promise<unknown>,
) => {
  vi.stubGlobal("window", {
    cutDesktop: {
      media: {
        acquirePlaybackUrl: async () => null,
        releasePlaybackUrl: async () => true,
        sourceState: async () => "online",
        ...(consolidate ? { consolidate } : {}),
        ...(consolidateRootFn ? { consolidateRoot: consolidateRootFn } : {}),
      },
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("is unavailable in the browser, where originals are copied anyway", () => {
  expect(canConsolidate()).toBe(false);
});

it("reports what moved and what did not", async () => {
  bridge(async () => ({
    ok: true,
    result: {
      moved: [{ assetId: "a1", relativePath: "clip.mp4" }],
      failed: [{ assetId: "a2", code: "SOURCE_OFFLINE" }],
      cancelled: false,
    },
  }));
  const outcome = await consolidateAssets(["a1", "a2"]);
  expect(outcome.moved).toHaveLength(1);
  expect(outcome.failed[0]!.code).toBe("SOURCE_OFFLINE");
});

it("surfaces a cancelled destination choice rather than looking successful", async () => {
  bridge(async () => ({ ok: false, error: { code: "CANCELLED", message: "No destination." } }));
  await expect(consolidateAssets(["a1"])).rejects.toThrow(/No destination/);
});

it("refuses a malformed response instead of trusting it", () => {
  expect(() => parseConsolidateResult({ ok: true, result: { moved: "many" } })).toThrow();
});

it("says the desktop app is required when the bridge is missing", async () => {
  bridge();
  await expect(consolidateAssets(["a1"])).rejects.toThrow(/macOS app/);
});

it("gathers everything under one location", async () => {
  const seen: string[] = [];
  bridge(undefined, async (rootId) => {
    seen.push(rootId);
    return {
      ok: true,
      result: { moved: [{ assetId: "a1" }], failed: [], cancelled: false },
    };
  });
  const outcome = await consolidateRoot("root-1");
  expect(seen).toEqual(["root-1"]);
  expect(outcome.moved).toHaveLength(1);
});

it("reports a cancelled picker with its own code so the caller can stay quiet", async () => {
  bridge(undefined, async () => ({
    ok: false,
    error: { code: "CANCELLED", message: "No destination was chosen." },
  }));
  await expect(consolidateRoot("root-1")).rejects.toMatchObject({ code: "CANCELLED" });
});
