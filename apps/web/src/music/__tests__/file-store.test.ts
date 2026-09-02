import { describe, expect, it } from "vitest";
import type { ID } from "@movie-desk/core";
import type { MusicRef } from "../types";
import {
  audioMimeFor,
  hashBlob,
  musicStoreKeepKeys,
  readMusicFile,
  safeFileName,
  saveMusicFile,
} from "../file-store";

describe("music file store", () => {
  it("hashes blobs deterministically as sha-256 hex", async () => {
    const a = await hashBlob(new Blob(["hello"]));
    const b = await hashBlob(new Blob(["hello"]));
    const c = await hashBlob(new Blob(["world"]));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips a file through the global store", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" });
    const hash = await hashBlob(file);

    await saveMusicFile(hash, file);
    const back = await readMusicFile(hash);

    expect(back).not.toBeNull();
    expect([...new Uint8Array(await back!.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("returns null for an unknown hash", async () => {
    expect(await readMusicFile("f".repeat(64))).toBeNull();
  });

  it("collects GC keep-keys only from refs that have a stored file", () => {
    const refs: MusicRef[] = [
      {
        id: "a" as ID,
        title: "Stored",
        license: "free",
        moods: [],
        scenes: [],
        fileHash: "abc123",
        addedAt: 1,
      },
      {
        id: "b" as ID,
        title: "Reference only",
        license: "paid",
        moods: [],
        scenes: [],
        addedAt: 2,
      },
    ];

    expect([...musicStoreKeepKeys(refs)]).toEqual(["music-store__abc123"]);
  });

  it("keeps store keys flat — OPFS file names must not contain slashes", () => {
    expect(
      [
        ...musicStoreKeepKeys([
          {
            id: "a" as ID,
            title: "T",
            license: "free",
            moods: [],
            scenes: [],
            fileHash: "h",
            addedAt: 1,
          },
        ]),
      ][0],
    ).not.toContain("/");
  });

  it("sanitizes file names for OPFS keys", () => {
    expect(safeFileName("Rain / Storm: Live?.mp3")).toBe("Rain _ Storm_ Live_.mp3");
    expect(safeFileName("///")).toBe("___");
    expect(safeFileName("")).toBe("audio");
    expect(safeFileName("a".repeat(200)).length).toBe(120);
  });

  it("guesses audio mime from the file extension", () => {
    expect(audioMimeFor("song.wav")).toBe("audio/wav");
    expect(audioMimeFor("song.m4a")).toBe("audio/mp4");
    expect(audioMimeFor("song.mp3")).toBe("audio/mpeg");
    expect(audioMimeFor("noext")).toBe("audio/mpeg");
  });
});
