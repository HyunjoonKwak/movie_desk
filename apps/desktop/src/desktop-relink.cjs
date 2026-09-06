const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeRelativePath } = require("./catalog.cjs");
const { stableRootId } = require("./image-import.cjs");
const { isPathInside, toDiskSourceRef } = require("./source-resolver.cjs");

const MIME_BY_EXTENSION = {
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".aiff": "audio/aiff",
};

const compareFingerprint = (asset, candidate) => {
  if (asset.sizeBytes !== candidate.sizeBytes) return "size";
  const key = asset.fullHash ? "fullHash" : "quickHash";
  return asset[key] && asset[key] === candidate[key] ? "identical" : "fingerprint";
};

// Exact relative paths only: no basename search, case folding, or fuzzy substitution.
const matchFolderPaths = (assets, directory) =>
  assets.map((asset) => {
    const relativePath = normalizeRelativePath(asset.relativePath);
    const candidatePath = path.resolve(directory, relativePath);
    if (!isPathInside(directory, candidatePath)) throw new Error("Unsafe relative path");
    return { asset, candidatePath };
  });

const publicSource = (asset) => {
  const sourceRef = toDiskSourceRef(asset);
  const { lastKnownAbsolutePath: _privatePath, ...rootSnapshot } = sourceRef.rootSnapshot;
  return { ...sourceRef, rootSnapshot };
};

class DesktopRelinker {
  #catalog;
  #helper;
  #pending = new Map();
  constructor({ catalog, helper }) {
    this.#catalog = catalog;
    this.#helper = helper;
  }

  async #inspect(asset, candidatePath) {
    const realPath = await fs.realpath(candidatePath);
    const before = await fs.stat(realPath);
    if (!before.isFile()) throw new Error("Selected item is not a file");
    const inspected = await this.#helper.request("inspect", { path: realPath });
    const mode = asset.fullHash ? "full" : "quick";
    const fingerprint = await this.#helper.request("fingerprint", { path: realPath, mode });
    const after = await fs.stat(realPath);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    ) {
      throw new Error("File changed during inspection; choose it again");
    }
    if (inspected.kind !== asset.mediaKind) throw new Error("Choose the same media type");
    const mime = MIME_BY_EXTENSION[path.extname(realPath).toLowerCase()];
    if (!mime) throw new Error("Unsupported media format");
    if (inspected.kind === "image" && (!(inspected.width > 0) || !(inspected.height > 0)))
      throw new Error("Image could not be decoded");
    const volume = await this.#helper.request("volume-resolve", { path: realPath });
    return {
      realPath,
      inspected,
      volume,
      mime,
      sizeBytes: after.size,
      modifiedAtMs: Math.trunc(after.mtimeMs),
      inode: String(after.ino),
      [mode === "full" ? "fullHash" : "quickHash"]: fingerprint.hash,
    };
  }

  async prepare(assetId, candidatePath, owner, selectedDirectory) {
    // Short-lived, sender-bound capabilities; absolute paths never reach the renderer.
    for (const [token, value] of this.#pending) {
      if (value.expiresAt < Date.now()) this.#pending.delete(token);
    }
    if (this.#pending.size >= 2000) throw new Error("Too many pending candidates; try again later");
    const asset = await this.#catalog.getAsset(assetId);
    if (!asset) throw new Error("Asset is absent from the catalog; restore a catalog backup first");
    const candidate = await this.#inspect(asset, candidatePath);
    const verdict = compareFingerprint(asset, candidate);
    const token = crypto.randomUUID();
    this.#pending.set(token, {
      asset,
      candidate,
      owner,
      selectedDirectory,
      expiresAt: Date.now() + 15 * 60_000,
    });
    return {
      assetId,
      token,
      name: path.basename(candidatePath),
      relativePath: asset.relativePath,
      verdict,
      sizeBytes: candidate.sizeBytes,
      expectedSizeBytes: asset.sizeBytes,
    };
  }

  async prepareFolder(assetIds, directory, owner) {
    const root = await fs.realpath(directory);
    const assets = await Promise.all(
      [...new Set(assetIds)].map((id) => this.#catalog.getAsset(id)),
    );
    const rows = [];
    for (const asset of assets.filter(Boolean)) {
      try {
        const [{ candidatePath }] = matchFolderPaths([asset], root);
        if (!isPathInside(root, await fs.realpath(candidatePath)))
          throw new Error("File is outside the selected folder");
        rows.push(await this.prepare(asset.id, candidatePath, owner, root));
      } catch {
        rows.push({ assetId: asset.id, relativePath: asset.relativePath, verdict: "unavailable" });
      }
    }
    return rows;
  }

  async commit(token, confirmed, owner) {
    const pending = this.#pending.get(token);
    if (!pending || pending.owner !== owner || pending.expiresAt < Date.now()) {
      throw new Error("Selection expired; choose the file again");
    }
    const { asset, candidate } = pending;
    const current = await this.#catalog.getAsset(asset.id);
    if (JSON.stringify(current) !== JSON.stringify(asset))
      throw new Error("Catalog changed; choose the file again");
    const fresh = await this.#inspect(asset, candidate.realPath);
    if (
      compareFingerprint(candidate, fresh) !== "identical" ||
      fresh.modifiedAtMs !== candidate.modifiedAtMs
    ) {
      this.#pending.delete(token);
      throw new Error("Selected file changed; choose it again");
    }
    const identical = compareFingerprint(asset, fresh) === "identical";
    if (!identical && confirmed !== true)
      throw new Error("Confirm the different fingerprint before connecting");
    const directory = pending.selectedDirectory ?? path.dirname(fresh.realPath);
    if (!isPathInside(directory, fresh.realPath)) throw new Error("File left the selected folder");
    const relativePath = path.relative(directory, fresh.realPath);
    const depth = relativePath.split(path.sep).length;
    let relativeDirectory = fresh.volume.volumeRelativePath ?? "";
    for (let i = 0; i < depth; i++) relativeDirectory = path.dirname(relativeDirectory);
    const rootId = stableRootId(fresh.volume.volumeUuid, directory, relativeDirectory);
    await this.#catalog.registerRoot({
      id: rootId,
      kind: fresh.volume.mountPoint?.startsWith("/Volumes/") ? "removable" : "local",
      volumeUuid: fresh.volume.volumeUuid,
      volumeRelativePath: relativeDirectory,
      lastKnownAbsolutePath: directory,
      caseSensitive: /case-sensitive/i.test(fresh.volume.fileSystem ?? ""),
    });
    const updated = await this.#catalog.upsertAsset({
      ...asset,
      rootId,
      relativePath,
      sizeBytes: fresh.sizeBytes,
      modifiedAtMs: fresh.modifiedAtMs,
      inode: fresh.inode,
      quickHash: fresh.quickHash ?? null,
      fullHash: fresh.fullHash ?? null,
      mime: fresh.mime,
    });
    this.#pending.delete(token);
    return {
      assetId: asset.id,
      identical,
      sourceRef: publicSource(updated),
      mime: updated.mime,
      width: fresh.inspected.width,
      height: fresh.inspected.height,
      durationMs: fresh.inspected.durationMs,
    };
  }
}

module.exports = { DesktopRelinker, compareFingerprint, matchFolderPaths };
