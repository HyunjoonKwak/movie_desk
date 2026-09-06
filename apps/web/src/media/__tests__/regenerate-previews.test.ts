import type { MediaAsset } from "@movie-desk/core";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  file: vi.fn(),
  audio: vi.fn(),
  image: vi.fn(),
  thumb: vi.fn(),
  strip: vi.fn(),
  waveform: vi.fn(),
  put: vi.fn(),
  release: vi.fn(),
  lease: vi.fn(),
}));
vi.mock("../source/resolve-media-source", () => ({
  resolveMediaSource: async () => ({ sizeBytes: 1e9, mime: "video/mp4", read: mocks.read }),
}));
vi.mock("@/persistence/opfs", () => ({ readMediaFile: mocks.file, writeMediaFile: vi.fn() }));
vi.mock("../audio/audio-variant", () => ({
  ensureAudioVariant: mocks.audio,
  audioVariantKey: () => "variant",
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
vi.mock("@/persistence/media-gc", () => ({ leaseMediaKey: mocks.lease }));
import { regenerateAssetPreviews, usePreviewRegenerationStore } from "../import";
const asset = {
  id: "a",
  name: "clip.mp4",
  kind: "video",
  opfsPath: "original",
  rotation: 90,
} as MediaAsset;
const audio = new Blob(["audio"]);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lease.mockReturnValue(mocks.release);
  mocks.file.mockResolvedValue(new Blob(["original"]));
  mocks.audio.mockResolvedValue(audio);
  mocks.thumb.mockResolvedValue("new thumb");
  mocks.strip.mockResolvedValue({ dataUrl: "strip", frames: 10 });
  mocks.waveform.mockResolvedValue([1]);
  mocks.put.mockResolvedValue(true);
});
it("references the OPFS Blob and decodes only the audio variant", async () => {
  expect((await regenerateAssetPreviews(asset)).failed).toEqual([]);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.thumb).toHaveBeenCalledWith(expect.any(File), 0.1, 90);
  expect(mocks.waveform).toHaveBeenCalledWith(audio);
  expect(mocks.put.mock.calls[0]?.[2]).toEqual({ replaceMissing: true });
  expect(mocks.release).toHaveBeenCalledTimes(3);
});
it("keeps an existing stored filmstrip when filmstrip generation fails", async () => {
  const stored: Record<string, unknown> = { filmstrip: "existing strip" };
  mocks.put.mockImplementation(async (_id, previews, options) => {
    if (options.replaceMissing) for (const key of Object.keys(stored)) delete stored[key];
    Object.assign(stored, previews);
  });
  mocks.strip.mockResolvedValue(null);
  expect((await regenerateAssetPreviews(asset)).failed).toEqual(["filmstrip"]);
  expect(stored.filmstrip).toBe("existing strip");
  expect(stored.thumb).toBe("new thumb");
});
it("passes disk sources directly to the ranged sampler without reading the full original", async () => {
  await regenerateAssetPreviews({ ...asset, sourceRef: { kind: "disk" } } as MediaAsset);
  expect(mocks.thumb.mock.calls[0]?.[0]).toMatchObject({ sizeBytes: 1e9, read: mocks.read });
  expect(mocks.read).not.toHaveBeenCalled();
});
it("does not fall back to the video container when no audio variant exists", async () => {
  mocks.audio.mockResolvedValue(null);
  expect((await regenerateAssetPreviews(asset)).failed).toEqual(["waveform"]);
  expect(mocks.waveform).not.toHaveBeenCalled();
});
it("releases acquired leases if acquiring a later lease throws", async () => {
  mocks.lease.mockImplementationOnce(() => {
    throw new Error("lease failed");
  });
  await expect(regenerateAssetPreviews(asset)).rejects.toThrow("lease failed");
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
it("classifies storage errors and releases leases", async () => {
  mocks.put.mockRejectedValueOnce(new Error("quota"));
  await expect(regenerateAssetPreviews(asset)).rejects.toMatchObject({ kind: "storage" });
  expect(mocks.release).toHaveBeenCalledTimes(3);
});
it("deduplicates across mounts and bounds active work to two assets", async () => {
  const resolvers: ((value: string) => void)[] = [];
  mocks.thumb.mockImplementation(() => new Promise<string>((resolve) => resolvers.push(resolve)));
  const first = regenerateAssetPreviews(asset);
  expect(regenerateAssetPreviews(asset)).toBe(first);
  const second = regenerateAssetPreviews({ ...asset, id: "b" } as MediaAsset);
  const third = regenerateAssetPreviews({ ...asset, id: "c" } as MediaAsset);
  await vi.waitFor(() => expect(mocks.thumb).toHaveBeenCalledTimes(2));
  expect(usePreviewRegenerationStore.getState().pending.size).toBe(3);
  resolvers[0]?.("thumb");
  await first;
  await vi.waitFor(() => expect(mocks.thumb).toHaveBeenCalledTimes(3));
  resolvers[1]?.("thumb");
  resolvers[2]?.("thumb");
  await Promise.all([second, third]);
  expect(usePreviewRegenerationStore.getState().pending.size).toBe(0);
});
