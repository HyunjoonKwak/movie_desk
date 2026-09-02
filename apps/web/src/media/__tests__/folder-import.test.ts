import { describe, expect, it } from "vitest";
import {
  collectDroppedMediaFiles,
  isSupportedMediaFile,
  linkImportedLivePhotos,
  planLivePhotoLinks,
  toMediaImportCandidate,
} from "../folder-import";
import { newId, type ID, type MediaAsset } from "@movie-desk/core";

const file = (name: string, type = ""): File => new File([name], name, { type });
const asset = (id: ID, name: string, kind: MediaAsset["kind"]): MediaAsset => ({
  id,
  name,
  kind,
  mime: kind === "image" ? "image/heic" : "video/quicktime",
  durationMs: kind === "image" ? 5000 : 3000,
  opfsPath: id,
  importedAt: 1,
});

describe("folder media import", () => {
  it("recognises media by MIME or a known extension when drag metadata omits MIME", () => {
    expect(isSupportedMediaFile(file("clip.MOV"))).toBe(true);
    expect(isSupportedMediaFile(file("voice.bin", "audio/wav"))).toBe(true);
    expect(isSupportedMediaFile(file("notes.txt", "text/plain"))).toBe(false);
  });

  it("pairs only one still and one MOV with the same stem in the same folder", () => {
    const candidates = [
      toMediaImportCandidate(file("IMG_0001.HEIC"), "DCIM/100APPLE/IMG_0001.HEIC"),
      toMediaImportCandidate(file("IMG_0001.MOV"), "DCIM/100APPLE/IMG_0001.MOV"),
      toMediaImportCandidate(file("IMG_0001.MOV"), "DCIM/101APPLE/IMG_0001.MOV"),
      toMediaImportCandidate(file("holiday.mov"), "DCIM/holiday.mov"),
    ];

    const links = planLivePhotoLinks(candidates);

    expect(links.get(0)).toEqual({ pairKey: "dcim/100apple/img_0001", role: "still" });
    expect(links.get(1)).toEqual({ pairKey: "dcim/100apple/img_0001", role: "motion" });
    expect(links.has(2)).toBe(false);
    expect(links.has(3)).toBe(false);
  });

  it("does not guess when duplicate stills make the pair ambiguous", () => {
    const candidates = [
      toMediaImportCandidate(file("IMG_0002.HEIC"), "IMG_0002.HEIC"),
      toMediaImportCandidate(file("IMG_0002.JPG"), "IMG_0002.JPG"),
      toMediaImportCandidate(file("IMG_0002.MOV"), "IMG_0002.MOV"),
    ];
    expect(planLivePhotoLinks(candidates).size).toBe(0);
  });

  it("adds a shared pair id only when both imports succeeded", () => {
    const candidates = [
      toMediaImportCandidate(file("IMG_0003.HEIC")),
      toMediaImportCandidate(file("IMG_0003.MOV")),
    ];
    const plan = planLivePhotoLinks(candidates);
    const pairId = newId();
    const linked = linkImportedLivePhotos(
      [
        { asset: asset(newId(), "IMG_0003.HEIC", "image"), candidateIndex: 0 },
        { asset: asset(newId(), "IMG_0003.MOV", "video"), candidateIndex: 1 },
      ],
      plan,
      () => pairId,
    );
    const partial = linkImportedLivePhotos(
      [{ asset: asset(newId(), "IMG_0003.MOV", "video"), candidateIndex: 1 }],
      plan,
      newId,
    );

    expect(linked.map((item) => item.livePhoto)).toEqual([
      { pairId, role: "still" },
      { pairId, role: "motion" },
    ]);
    expect(partial[0]?.livePhoto).toBeUndefined();
  });

  it("recursively drains directory reader batches and sorts discovered media", async () => {
    const makeFileEntry = (name: string, fullPath: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file: (success: (value: File) => void) => success(file(name)),
    });
    const batches = [
      [makeFileEntry("IMG_10.MOV", "/DCIM/IMG_10.MOV")],
      [makeFileEntry("IMG_2.HEIC", "/DCIM/IMG_2.HEIC")],
      [],
    ];
    const directory = {
      isFile: false,
      isDirectory: true,
      name: "DCIM",
      fullPath: "/DCIM",
      createReader: () => ({
        readEntries: (success: (entries: unknown[]) => void) => success(batches.shift() ?? []),
      }),
    };
    const transfer = {
      files: [] as unknown as FileList,
      items: [{ webkitGetAsEntry: () => directory }] as unknown as DataTransferItemList,
    };

    const collected = await collectDroppedMediaFiles(transfer);

    expect(collected.candidates.map((candidate) => candidate.relativePath)).toEqual([
      "DCIM/IMG_2.HEIC",
      "DCIM/IMG_10.MOV",
    ]);
    expect(collected.unreadablePaths).toEqual([]);
  });
});
