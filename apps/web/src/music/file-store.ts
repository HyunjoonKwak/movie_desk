import { readMediaFile, writeMediaFile } from "@/persistence/opfs";
import type { MusicRef } from "./types";

// App-global, content-addressed music file store. Audio linked to a music
// reference is copied here under its SHA-256 so ANY project can restore it
// later — media GC keeps these keys alive while a ref still points at them
// (see collectMediaGarbage) and reaps them once the ref is deleted.
//
// OPFS keys are FLAT file names: "/" is illegal in getFileHandle, hence
// the "__" separator (same convention as media import's `${id}__${name}`).

const MUSIC_STORE_PREFIX = "music-store__";

export const musicStoreKey = (hash: string): string => `${MUSIC_STORE_PREFIX}${hash}`;

// File/OPFS-safe name: strips path separators and control characters that
// make OPFS getFileHandle throw, and caps runaway lengths.
export const safeFileName = (name: string): string => {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join("")
    .trim();
  return (cleaned || "audio").slice(0, 120);
};

// Best-effort audio mime from a file name, for blobs that lost their type.
export const audioMimeFor = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
    case "aac":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    default:
      return "audio/mpeg";
  }
};

export const hashBlob = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const saveMusicFile = async (hash: string, file: File): Promise<void> => {
  await writeMediaFile(musicStoreKey(hash), file);
};

export const readMusicFile = async (hash: string): Promise<Blob | null> =>
  readMediaFile(musicStoreKey(hash));

// OPFS keys the media GC must not delete while a music ref references them.
export const musicStoreKeepKeys = (refs: readonly MusicRef[]): ReadonlySet<string> =>
  new Set(refs.filter((r) => r.fileHash).map((r) => musicStoreKey(r.fileHash!)));
