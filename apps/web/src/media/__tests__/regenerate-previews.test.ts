import type { MediaAsset } from "@movie-desk/core";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  image: vi.fn(),
  thumb: vi.fn(),
  strip: vi.fn(),
  waveform: vi.fn(),
  put: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../source/resolve-media-source", () => ({
  resolveMediaSource: async () => ({ sizeBytes: 3, mime: "video/mp4", read: mocks.read }),
}));
vi.mock("../thumbnail", () => ({
  makeImageThumb: mocks.image,
  makeVideoThumb: mocks.thumb,
  makeVideoFilmstrip: mocks.strip,
}));
vi.mock("../waveform", () => ({ extractWaveformPeaks: mocks.waveform }));
vi.mock("@/persistence/previews", () => ({
  putAssetPreviews: mocks.put,
  leasePreview: () => mocks.release,
}));
vi.mock("@/persistence/media-gc", () => ({ leaseMediaKey: () => mocks.release }));
import { regenerateAssetPreviews } from "../import";
const asset = {
  id: "a",
  name: "clip.mp4",
  kind: "video",
  opfsPath: "original",
  rotation: 90,
} as MediaAsset;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(new ArrayBuffer(3));
  mocks.thumb.mockResolvedValue("new thumb");
  mocks.strip.mockResolvedValue(null);
  mocks.waveform.mockResolvedValue(null);
  mocks.put.mockResolvedValue(true);
});
it("writes regenerated fields with default replacement so stale missing fields disappear", async () => {
  await regenerateAssetPreviews(asset);
  expect(mocks.read).toHaveBeenCalledWith(0, 3);
  expect(mocks.thumb).toHaveBeenCalledWith(expect.any(File), 0.1, 90);
  expect(mocks.put).toHaveBeenCalledWith("a", { thumb: "new thumb" });
  expect(mocks.release).toHaveBeenCalledTimes(2);
});
it("releases leases and reports a storage failure", async () => {
  mocks.put.mockRejectedValueOnce(new Error("quota"));
  await expect(regenerateAssetPreviews(asset)).rejects.toThrow("quota");
  expect(mocks.release).toHaveBeenCalledTimes(2);
});
