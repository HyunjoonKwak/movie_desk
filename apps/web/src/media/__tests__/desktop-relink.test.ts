import type { MediaAsset } from "@movie-desk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DesktopRelinkCandidate,
  commitDesktopRelink,
  matchDesktopRelinkRows,
} from "../desktop-relink";

const asset = (id: string, relativePath: string) =>
  ({ id, sourceRef: { kind: "disk", relativePath } }) as MediaAsset;
const row = (
  assetId: string,
  relativePath: string,
  verdict: DesktopRelinkCandidate["verdict"] = "identical",
): DesktopRelinkCandidate => ({ assetId, relativePath, verdict });

describe("desktop folder relink preview", () => {
  it("never uses same basenames in other directories or cases as identity", () => {
    const assets = [asset("a", "day1/clip.mov"), asset("b", "day2/clip.mov")];
    const rows = [row("a", "day2/clip.mov"), row("a", "DAY1/clip.mov"), row("b", "day2/clip.mov")];
    expect(matchDesktopRelinkRows(assets, rows)).toEqual([rows[2]]);
  });
  it("retains unavailable and mismatch verdicts and rejects unknown or OPFS records", () => {
    const assets = [asset("a", "clip.mov"), { id: "web", opfsPath: "clip.mov" } as MediaAsset];
    const rows = [
      row("a", "clip.mov", "fingerprint"),
      row("a", "clip.mov", "unavailable"),
      row("unknown", "clip.mov"),
      row("web", "clip.mov"),
    ];
    expect(matchDesktopRelinkRows(assets, rows)).toEqual(rows.slice(0, 2));
  });
});

vi.mock("@/persistence/previews", () => ({ putAssetPreviews: vi.fn() }));
vi.mock("@/persistence/opfs", () => ({ deleteMediaFile: vi.fn() }));
vi.mock("../relink", () => ({
  buildRelinkPreviews: vi.fn(async () => ({
    width: 4096,
    height: 4096,
    sizeBytes: 9000,
    mime: "image/jpeg",
    dropProxy: true,
    previewsStored: true,
  })),
}));
vi.mock("../source/resolve-media-source", () => ({
  resolveMediaSource: vi.fn(async () => ({
    acquirePlaybackUrl: async () => ({ url: "media://asset/image?lease=test", release: vi.fn() }),
  })),
}));
afterEach(() => vi.unstubAllGlobals());

it("keeps original image dimensions and size when the editing preview is rescaled", async () => {
  const sourceRef = {
    kind: "disk",
    version: 1,
    rootId: "r",
    rootSnapshot: {},
    relativePath: "photo.heic",
    sizeBytes: 200,
    modifiedAtMs: 3,
  };
  vi.stubGlobal("window", {
    cutDesktop: {
      media: {
        acquirePlaybackUrl: vi.fn(),
        releasePlaybackUrl: vi.fn(),
        sourceState: vi.fn(),
        commitRelink: async () => ({
          assetId: "a",
          identical: false,
          width: 2,
          height: 2,
          mime: "image/heic",
          sourceRef,
        }),
      },
    },
  });
  vi.stubGlobal("fetch", async () => new Response(new Blob(["preview"], { type: "image/jpeg" })));
  const original = {
    ...asset("a", "photo.heic"),
    name: "photo.heic",
    kind: "image",
    durationMs: 5000,
  } as MediaAsset;
  const patch = await commitDesktopRelink(
    { ...row("a", "photo.heic", "fingerprint"), token: "selected" },
    true,
    original,
  );
  expect(patch).toMatchObject({
    width: 2,
    height: 2,
    sizeBytes: 200,
    mime: "image/heic",
    previewsStored: true,
    dropProxy: true,
  });
});
