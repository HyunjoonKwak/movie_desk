const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { toDiskSourceRef } = require("./source-resolver.cjs");

const THUMB_DIMENSION = 240;
const EDIT_DIMENSION = 4096;
const PREVIEW_PIPELINE = "sips-preview-v1";
const HEIC_EXTENSIONS = new Map([
  [".heic", "image/heic"],
  [".heif", "image/heif"],
]);

const createDesktopImageImporter = ({ catalog, helper, cacheDirectory }) => {
  if (
    !catalog ||
    typeof catalog.registerRoot !== "function" ||
    typeof catalog.upsertAsset !== "function" ||
    typeof catalog.getAssetByLocation !== "function"
  ) {
    throw new TypeError("catalog is required");
  }
  if (!helper || typeof helper.request !== "function") throw new TypeError("helper is required");
  if (typeof cacheDirectory !== "string" || !path.isAbsolute(cacheDirectory)) {
    throw new TypeError("cacheDirectory must be absolute");
  }

  const renderCachedPreview = async (asset, sourcePath, variant, maxDimension) => {
    const fingerprint = cacheFingerprint(asset);
    const directory = path.join(cacheDirectory, PREVIEW_PIPELINE, fingerprint);
    const outputPath = path.join(directory, `${variant}.jpg`);
    try {
      const outputStat = await fs.promises.stat(outputPath);
      if (outputStat.isFile() && outputStat.size > 0) return previewSource(outputPath, outputStat);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${variant}-${crypto.randomUUID()}.tmp.jpg`);
    try {
      await helper.request("preview", {
        sourcePath,
        outputPath: temporaryPath,
        maxDimension,
        format: "jpeg",
      });
      const temporaryStat = await fs.promises.stat(temporaryPath);
      if (!temporaryStat.isFile() || temporaryStat.size === 0) {
        throw importError("PREVIEW_FAILED", "ImageIO produced an empty preview");
      }
      await fs.promises.rename(temporaryPath, outputPath);
      return previewSource(outputPath, await fs.promises.stat(outputPath));
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }
  };

  return {
    async importHeicFile(untrustedPath) {
      const sourcePath = await validateHeicPath(untrustedPath);
      const fileStat = await fs.promises.stat(sourcePath);
      const volume = await helper.request("volume-resolve", { path: sourcePath });
      const inspected = await helper.request("inspect", { path: sourcePath });
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

      const relativePath = path.basename(sourcePath);
      const existingAsset = await catalog.getAssetByLocation(rootId, relativePath);
      const id = existingAsset?.id ?? crypto.randomUUID();
      const mime = HEIC_EXTENSIONS.get(path.extname(sourcePath).toLowerCase());
      const catalogAsset = await catalog.upsertAsset({
        id,
        rootId,
        relativePath,
        sizeBytes: Number(fileStat.size),
        modifiedAtMs: Math.trunc(fileStat.mtimeMs),
        inode: fileStat.ino == null ? undefined : String(fileStat.ino),
        quickHash: fingerprint.hash,
        mime,
        mediaKind: "image",
      });
      const thumbnail = await renderCachedPreview(
        catalogAsset,
        sourcePath,
        "thumb-240",
        THUMB_DIMENSION,
      );
      const thumbnailBytes = await fs.promises.readFile(thumbnail.absolutePath);
      const width = positiveIntegerOrUndefined(inspected.width);
      const height = positiveIntegerOrUndefined(inspected.height);
      const gpsLat = finiteOrUndefined(inspected.gpsLat);
      const gpsLon = finiteOrUndefined(inspected.gpsLon);
      const catalogSourceRef = toDiskSourceRef(catalogAsset);
      const { lastKnownAbsolutePath: _privatePath, ...publicRootSnapshot } =
        catalogSourceRef.rootSnapshot;
      return {
        id,
        name: path.basename(sourcePath),
        kind: "image",
        mime,
        durationMs: 5000,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        opfsPath: `disk-v1/${id}`,
        sourceRef: { ...catalogSourceRef, rootSnapshot: publicRootSnapshot },
        sizeBytes: Number(fileStat.size),
        capturedAt:
          finiteOrUndefined(inspected.capturedAtMs) ?? Math.max(0, Math.trunc(fileStat.mtimeMs)),
        ...(gpsLat !== undefined && gpsLon !== undefined ? { gpsLat, gpsLon } : {}),
        sourceImageMetadata: compactMetadata(inspected),
        thumbDataUrl: `data:image/jpeg;base64,${thumbnailBytes.toString("base64")}`,
        importedAt: Date.now(),
      };
    },

    async acquireEditingPreview(asset, resolvedSource) {
      if (!isHeicMime(asset?.mime)) {
        throw importError("UNSUPPORTED_FORMAT", "an editing preview is only needed for HEIC/HEIF");
      }
      if (!resolvedSource || !path.isAbsolute(resolvedSource.absolutePath ?? "")) {
        throw importError("SOURCE_NOT_FOUND", "the original image is not currently available");
      }
      return renderCachedPreview(
        asset,
        resolvedSource.absolutePath,
        "preview-4096",
        EDIT_DIMENSION,
      );
    },
  };
};

const validateHeicPath = async (value) => {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw importError("INVALID_REQUEST", "HEIC import requires an absolute file path");
  }
  const extension = path.extname(value).toLowerCase();
  if (!HEIC_EXTENSIONS.has(extension)) {
    throw importError(
      "UNSUPPORTED_FORMAT",
      "only HEIC and HEIF files use the native image importer",
    );
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
      throw importError("PERMISSION_DENIED", "Movie Desk cannot read the selected file");
    }
    throw error;
  }
};

const stableRootId = (volumeUuid, absoluteDirectory, relativeDirectory) => {
  const location = volumeUuid
    ? `${volumeUuid}\0${relativeDirectory}`
    : `path\0${absoluteDirectory}`;
  return `root-${crypto.createHash("sha256").update(location).digest("hex").slice(0, 32)}`;
};

const rootKind = (volume) => {
  if (/smb|nfs|afp|webdav/i.test(volume.fileSystem ?? "")) return "network";
  return volume.mountPoint?.startsWith("/Volumes/") ? "removable" : "local";
};

const cacheFingerprint = (asset) =>
  crypto
    .createHash("sha256")
    .update(
      [asset.id, asset.sizeBytes, asset.modifiedAtMs, asset.quickHash ?? "no-quick-hash"].join(
        "\0",
      ),
    )
    .digest("hex");

const previewSource = (absolutePath, fileStat) => ({
  absolutePath,
  asset: {
    sizeBytes: Number(fileStat.size),
    modifiedAtMs: Math.trunc(fileStat.mtimeMs),
    mime: "image/jpeg",
  },
});

const compactMetadata = (value) => {
  const orientation = positiveIntegerOrUndefined(value.orientation);
  const cameraMake = textOrUndefined(value.cameraMake);
  const cameraModel = textOrUndefined(value.cameraModel);
  const lensModel = textOrUndefined(value.lensModel);
  const colorSpace = textOrUndefined(value.colorSpace);
  const colorProfile = textOrUndefined(value.colorProfile);
  return {
    ...(orientation ? { orientation } : {}),
    ...(cameraMake ? { cameraMake } : {}),
    ...(cameraModel ? { cameraModel } : {}),
    ...(lensModel ? { lensModel } : {}),
    ...(colorSpace ? { colorSpace } : {}),
    ...(colorProfile ? { colorProfile } : {}),
  };
};

const positiveIntegerOrUndefined = (value) =>
  Number.isSafeInteger(value) && value > 0 ? value : undefined;
const finiteOrUndefined = (value) => (Number.isFinite(value) ? Number(value) : undefined);
const textOrUndefined = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const isHeicMime = (value) => value === "image/heic" || value === "image/heif";
const importError = (code, message) => Object.assign(new Error(message), { code });

module.exports = {
  EDIT_DIMENSION,
  PREVIEW_PIPELINE,
  THUMB_DIMENSION,
  createDesktopImageImporter,
  isHeicMime,
  stableRootId,
  validateHeicPath,
};
