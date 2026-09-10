"use strict";

// Register a user's file where it already lives instead of copying it into the
// app. The HEIC importer has done this since A4; this widens the same path to
// ordinary video and image files so a large library never has to be duplicated.
// See docs/decisions/2026-09-03-local-media-storage.md and
// docs/decisions/2026-09-08-library-model.md.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { stableRootId } = require("./image-import.cjs");

const VIDEO_EXTENSIONS = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
]);
const IMAGE_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const AUDIO_EXTENSIONS = new Map([
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".wav", "audio/wav"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
]);

const importError = (code, message) => Object.assign(new Error(message), { code });

const mediaKindFor = (extension) => {
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return undefined;
};

const mimeFor = (extension) =>
  VIDEO_EXTENSIONS.get(extension) ??
  IMAGE_EXTENSIONS.get(extension) ??
  AUDIO_EXTENSIONS.get(extension);

/** Absolute, readable, a real file, and a format we can reference. */
const validateSourcePath = async (value) => {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw importError("INVALID_REQUEST", "reference import requires an absolute file path");
  }
  const extension = path.extname(value).toLowerCase();
  if (!mediaKindFor(extension)) {
    throw importError("UNSUPPORTED_FORMAT", "this file type is not referenced in place");
  }
  try {
    const realPath = await fs.promises.realpath(value);
    const fileStat = await fs.promises.stat(realPath);
    if (!fileStat.isFile()) throw importError("NOT_A_FILE", "the selected item is not a file");
    await fs.promises.access(realPath, fs.constants.R_OK);
    return realPath.normalize("NFC");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw importError("SOURCE_NOT_FOUND", "the selected file was not found");
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw importError("PERMISSION_DENIED", "Movie Desk cannot read this file");
    }
    throw error;
  }
};

const rootKind = (volume) => {
  if (volume?.isNetwork) return "network";
  if (volume?.isRemovable) return "removable";
  return "local";
};

const positiveIntegerOrUndefined = (value) =>
  Number.isSafeInteger(value) && value > 0 ? value : undefined;
const finiteOrUndefined = (value) => (Number.isFinite(value) ? Number(value) : undefined);

/**
 * Register the folder a file sits in and return its root id. Shared with
 * consolidation, which needs a root for the destination it just copied into.
 */
const registerRootForFile = async ({ catalog, helper }, filePath) => {
  const volume = await helper.request("volume-resolve", { path: filePath });
  const directory = path.dirname(filePath);
  const rootRelativePath = path.dirname(volume.volumeRelativePath ?? "");
  const rootId = stableRootId(volume.volumeUuid, directory, rootRelativePath);
  await catalog.registerRoot({
    id: rootId,
    kind: rootKind(volume),
    ...(volume.volumeUuid ? { volumeUuid: volume.volumeUuid } : {}),
    ...(rootRelativePath && rootRelativePath !== "."
      ? { volumeRelativePath: rootRelativePath }
      : {}),
    lastKnownAbsolutePath: directory,
    caseSensitive: /case-sensitive/i.test(volume.fileSystem ?? ""),
  });
  return rootId;
};

const createReferenceImporter = ({ catalog, helper, toDiskSourceRef }) => ({
  /**
   * Never copies, moves or writes the original. The catalog learns where the
   * file is; the bytes stay exactly where the user put them.
   */
  async importFile(untrustedPath) {
    const sourcePath = await validateSourcePath(untrustedPath);
    const extension = path.extname(sourcePath).toLowerCase();
    const fileStat = await fs.promises.stat(sourcePath);
    const volume = await helper.request("volume-resolve", { path: sourcePath });
    const fingerprint = await helper.request("fingerprint", { path: sourcePath, mode: "quick" });
    const sourceDirectory = path.dirname(sourcePath);
    const rootRelativePath = path.dirname(volume.volumeRelativePath ?? "");
    const rootId = stableRootId(volume.volumeUuid, sourceDirectory, rootRelativePath);
    await catalog.registerRoot({
      id: rootId,
      kind: rootKind(volume),
      ...(volume.volumeUuid ? { volumeUuid: volume.volumeUuid } : {}),
      ...(rootRelativePath && rootRelativePath !== "."
        ? { volumeRelativePath: rootRelativePath }
        : {}),
      lastKnownAbsolutePath: sourceDirectory,
      caseSensitive: /case-sensitive/i.test(volume.fileSystem ?? ""),
    });

    // Re-importing the same file keeps its identity so existing projects that
    // reference it stay linked.
    const relativePath = path.basename(sourcePath);
    const existing = await catalog.getAssetByLocation(rootId, relativePath);
    const id = existing?.id ?? crypto.randomUUID();
    const mime = mimeFor(extension);
    const mediaKind = mediaKindFor(extension);
    const catalogAsset = await catalog.upsertAsset({
      id,
      rootId,
      relativePath,
      sizeBytes: Number(fileStat.size),
      modifiedAtMs: Math.trunc(fileStat.mtimeMs),
      inode: fileStat.ino == null ? undefined : String(fileStat.ino),
      quickHash: fingerprint.hash,
      mime,
      mediaKind,
    });

    // Probing is best effort: a container we cannot inspect is still importable
    // and the renderer will decode it, so one odd file cannot block a batch.
    let inspected = {};
    try {
      inspected = await helper.request("inspect", { path: sourcePath });
    } catch {
      inspected = {};
    }
    const width = positiveIntegerOrUndefined(inspected.width);
    const height = positiveIntegerOrUndefined(inspected.height);
    const durationMs = positiveIntegerOrUndefined(inspected.durationMs);
    const capturedAt = finiteOrUndefined(inspected.capturedAt);

    const sourceRef = toDiskSourceRef(catalogAsset);
    // The last absolute path is a recovery hint for the main process only; page
    // JavaScript never receives it.
    const { lastKnownAbsolutePath: _hint, ...publicRootSnapshot } = sourceRef.rootSnapshot;
    return {
      id,
      name: relativePath,
      kind: mediaKind,
      mime,
      durationMs: durationMs ?? (mediaKind === "image" ? 5000 : 0),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      opfsPath: `disk-v1/${id}`,
      sourceRef: { ...sourceRef, rootSnapshot: publicRootSnapshot },
      sizeBytes: Number(fileStat.size),
      ...(capturedAt ? { capturedAt } : {}),
    };
  },
});

module.exports = {
  AUDIO_EXTENSIONS,
  registerRootForFile,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  createReferenceImporter,
  mediaKindFor,
  mimeFor,
  validateSourcePath,
};
