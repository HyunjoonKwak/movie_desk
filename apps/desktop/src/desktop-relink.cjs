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
  #jobs = new Map();
  #now;
  constructor({ catalog, helper, now = Date.now }) {
    this.#now = now;
    this.#catalog = catalog;
    this.#helper = helper;
  }

  async #request(command, input, signal) {
    signal?.throwIfAborted();
    if (!signal) return this.#helper.request(command, input);
    let abort;
    try {
      return await Promise.race([this.#helper.request(command, input), new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      })]);
    } finally { signal.removeEventListener("abort", abort); }
  }

  async #inspect(asset, candidatePath, { preview = false, volume, signal } = {}) {
    signal?.throwIfAborted();
    const realPath = await fs.realpath(candidatePath);
    const before = await fs.stat(realPath);
    if (!before.isFile()) throw new Error("Selected item is not a file");
    const inspected = await this.#request("inspect", { path: realPath }, signal);
    signal?.throwIfAborted();
    const mode = !preview && asset.fullHash ? "full" : "quick";
    const fingerprint = await this.#request("fingerprint", { path: realPath, mode }, signal);
    signal?.throwIfAborted();
    const after = await fs.stat(realPath);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    ) {
      throw new Error("File changed during inspection; choose it again");
    }
    if (inspected.kind !== asset.mediaKind) throw Object.assign(new Error("Choose the same media type"), { code: "kind" });
    const mime = MIME_BY_EXTENSION[path.extname(realPath).toLowerCase()];
    if (mime && mime.split("/")[0] !== asset.mediaKind) throw Object.assign(new Error("Choose the same media type"), { code: "kind" });
    if (!mime) throw Object.assign(new Error("Unsupported media format"), { code: "unsupported" });
    if (inspected.kind === "image" && (!(inspected.width > 0) || !(inspected.height > 0)))
      throw Object.assign(new Error("Image could not be decoded"), { code: "decode" });
    volume ??= await this.#helper.request("volume-resolve", { path: realPath });
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

  async prepare(assetId, candidatePath, owner, selectedDirectory, options = {}) {
    // Short-lived, sender-bound capabilities; absolute paths never reach the renderer.
    for (const [token, value] of this.#pending) {
      if (value.expiresAt < this.#now()) this.#pending.delete(token);
    }
    if (this.#pending.size >= 2000) throw Object.assign(new Error("Too many pending candidates; try again later"), { code: "capacity" });
    const asset = await this.#catalog.getAsset(assetId);
    if (!asset) throw new Error("Asset is absent from the catalog; restore a catalog backup first");
    const candidate = await this.#inspect(asset, candidatePath, options);
    const verdict = compareFingerprint(asset, candidate);
    options.signal?.throwIfAborted();
    if (this.#pending.size >= 2000) throw Object.assign(new Error("Pending capacity exceeded"), { code: "capacity" });
    const token = crypto.randomUUID();
    this.#pending.set(token, {
      asset,
      candidate,
      owner,
      selectedDirectory,
      preview: options.preview,
      expiresAt: this.#now() + 15 * 60_000,
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

  cancel(owner) {
    this.#jobs.get(owner)?.abort();
    for (const [token, pending] of this.#pending) {
      if (pending.owner === owner) this.#pending.delete(token);
    }
  }

  async prepareFolder(assetIds, directory, owner, onProgress = () => {}) {
    if (assetIds.length > 1000) return { tooMany: true };
    this.cancel(owner);
    const controller = new AbortController();
    this.#jobs.set(owner, controller);
    const { signal } = controller;
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("Preview timed out"), { code: "timeout" })), 120_000);
    const rows = [];
    let completed = false;
    try {
      const root = await fs.realpath(directory);
      const volume = await this.#request("volume-resolve", { path: root }, signal);
      const ids = [...new Set(assetIds)];
      for (const id of ids) {
        signal.throwIfAborted();
        const asset = await this.#catalog.getAsset(id);
        if (!asset) continue;
        try {
          const [{ candidatePath }] = matchFolderPaths([asset], root);
          if (!isPathInside(root, await fs.realpath(candidatePath)))
            throw Object.assign(new Error("Outside folder"), { code: "outside" });
          rows.push(await this.prepare(asset.id, candidatePath, owner, root, {
            preview: true, signal,
            volume: { ...volume, volumeRelativePath: path.join(volume.volumeRelativePath ?? "", asset.relativePath) },
          }));
        } catch (error) {
          signal.throwIfAborted();
          if (error.code === "capacity") throw error;
          rows.push({ assetId: asset.id, relativePath: asset.relativePath, verdict: "unavailable",
            reason: ["kind", "unsupported", "decode", "outside"].includes(error.code) ? error.code : "unavailable",
            expectedSizeBytes: asset.sizeBytes });
        }
        onProgress({ completed: rows.length, total: ids.length });
      }
      completed = true;
      return rows;
    } finally {
      clearTimeout(timer);
      if (this.#jobs.get(owner) === controller) this.#jobs.delete(owner);
      if (!completed) {
        for (const row of rows) if (row.token) this.#pending.delete(row.token);
      }
    }
  }

  async commit(token, confirmed, owner) {
    const pending = this.#pending.get(token);
    if (!pending || pending.owner !== owner || pending.expiresAt < this.#now()) {
      throw new Error("Selection expired; choose the file again");
    }
    const { asset, candidate } = pending;
    const current = await this.#catalog.getAsset(asset.id);
    if (!current || ["rootId", "relativePath", "sizeBytes", "modifiedAtMs", "inode", "quickHash", "fullHash", "mime", "mediaKind"].some((key) => current[key] !== asset[key]) ||
      ["volumeUuid", "volumeRelativePath", "lastKnownAbsolutePath", "caseSensitive"].some((key) => current.root[key] !== asset.root[key]))
      throw new Error("Catalog changed; choose the file again");
    const fresh = await this.#inspect(asset, candidate.realPath);
    if (pending.preview && !fresh.quickHash) {
      fresh.quickHash = (await this.#helper.request("fingerprint", { path: fresh.realPath, mode: "quick" })).hash;
    }
    if (
      compareFingerprint(candidate, fresh) !== "identical" ||
      fresh.modifiedAtMs !== candidate.modifiedAtMs
    ) {
      this.#pending.delete(token);
      throw new Error("Selected file changed; choose it again");
    }
    const afterHash = await fs.stat(fresh.realPath);
    if (afterHash.size !== fresh.sizeBytes || Math.trunc(afterHash.mtimeMs) !== fresh.modifiedAtMs || String(afterHash.ino) !== fresh.inode)
      throw new Error("Selected file changed; choose it again");
    const identical = compareFingerprint(asset, fresh) === "identical";
    if (!identical && confirmed !== true)
      throw new Error("Confirm the different fingerprint before connecting");
    const directory = pending.selectedDirectory ?? path.dirname(fresh.realPath);
    if (!isPathInside(directory, fresh.realPath)) throw new Error("File left the selected folder");
    const relativePath = path.relative(directory, fresh.realPath);
    const depth = relativePath.split(path.sep).length;
    let relativeDirectory = fresh.volume.volumeRelativePath ?? "";
    for (let i = 0; i < depth; i++) relativeDirectory = path.dirname(relativeDirectory);
    if (relativeDirectory === ".") relativeDirectory = "";
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
      quickHash: fresh.quickHash ?? (identical ? asset.quickHash : null),
      fullHash: fresh.fullHash ?? (identical ? asset.fullHash : null),
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
