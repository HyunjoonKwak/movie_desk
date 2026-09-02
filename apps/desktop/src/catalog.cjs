const path = require("node:path");
const { Worker } = require("node:worker_threads");

const ROOT_KINDS = new Set(["local", "removable", "network"]);
const MEDIA_KINDS = new Set(["video", "audio", "image", "unknown"]);
const DECISIONS = new Set(["accepted", "rejected"]);

class MediaCatalog {
  #worker;
  #nextId = 1;
  #pending = new Map();
  #closed = false;
  #startupError;
  #workerError;

  constructor(databasePath) {
    if (typeof databasePath !== "string" || databasePath.length === 0) {
      throw new TypeError("databasePath must be a non-empty string");
    }
    this.#worker = new Worker(path.join(__dirname, "catalog-worker.cjs"), {
      workerData: { databasePath },
    });
    this.#worker.on("message", (message) => this.#onMessage(message));
    this.#worker.on("error", (error) => {
      this.#workerError = error;
      this.#failAll(error);
    });
    this.#worker.on("exit", (code) => {
      if (!this.#closed) {
        this.#workerError = new Error(`catalog worker exited with code ${code}`);
        this.#failAll(this.#workerError);
      }
    });
  }

  ready() {
    return this.#request("ready");
  }

  registerRoot(input) {
    const now = Date.now();
    const root = {
      id: requiredText(input?.id, "root.id"),
      kind: enumValue(input?.kind, ROOT_KINDS, "root.kind"),
      volumeUuid: optionalText(input?.volumeUuid, "root.volumeUuid"),
      volumeRelativePath: optionalText(input?.volumeRelativePath, "root.volumeRelativePath"),
      lastKnownAbsolutePath: requiredAbsolutePath(
        input?.lastKnownAbsolutePath,
        "root.lastKnownAbsolutePath",
      ),
      caseSensitive: input?.caseSensitive === true,
      createdAtMs: nonNegativeInteger(input?.createdAtMs ?? now, "root.createdAtMs"),
      updatedAtMs: nonNegativeInteger(input?.updatedAtMs ?? now, "root.updatedAtMs"),
    };
    return this.#request("registerRoot", root);
  }

  getRoot(rootId) {
    return this.#request("getRoot", requiredText(rootId, "rootId"));
  }

  async upsertAsset(input) {
    const rootId = requiredText(input?.rootId, "asset.rootId");
    const root = await this.getRoot(rootId);
    if (!root) throw new Error(`unknown source root: ${rootId}`);
    const now = Date.now();
    const relativePath = normalizeRelativePath(input?.relativePath);
    const asset = {
      id: requiredText(input?.id, "asset.id"),
      rootId,
      relativePath,
      relativePathKey: root.caseSensitive ? relativePath : relativePath.toLocaleLowerCase("en-US"),
      sizeBytes: nonNegativeInteger(input?.sizeBytes, "asset.sizeBytes"),
      modifiedAtMs: nonNegativeInteger(input?.modifiedAtMs, "asset.modifiedAtMs"),
      inode: optionalText(input?.inode, "asset.inode"),
      quickHash: optionalText(input?.quickHash, "asset.quickHash"),
      fullHash: optionalText(input?.fullHash, "asset.fullHash"),
      mime:
        input?.mime == null ? "application/octet-stream" : requiredText(input.mime, "asset.mime"),
      mediaKind: enumValue(input?.mediaKind ?? "unknown", MEDIA_KINDS, "asset.mediaKind"),
      createdAtMs: nonNegativeInteger(input?.createdAtMs ?? now, "asset.createdAtMs"),
      updatedAtMs: nonNegativeInteger(input?.updatedAtMs ?? now, "asset.updatedAtMs"),
    };
    return this.#request("upsertAsset", asset);
  }

  getAsset(assetId) {
    return this.#request("getAsset", requiredText(assetId, "assetId"));
  }

  setUserMetadata(input) {
    const tags = input?.tags ?? [];
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
      throw new TypeError("metadata.tags must be an array of non-empty strings");
    }
    const rating = input?.rating ?? null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
      throw new RangeError("metadata.rating must be null or an integer from 0 to 5");
    }
    const decision = input?.decision ?? null;
    if (decision !== null && !DECISIONS.has(decision)) {
      throw new TypeError("metadata.decision must be null, accepted, or rejected");
    }
    return this.#request("setUserMetadata", {
      assetId: requiredText(input?.assetId, "metadata.assetId"),
      rating,
      tags,
      note: input?.note == null ? "" : String(input.note),
      decision,
      updatedAtMs: nonNegativeInteger(input?.updatedAtMs ?? Date.now(), "metadata.updatedAtMs"),
    });
  }

  getUserMetadata(assetId) {
    return this.#request("getUserMetadata", requiredText(assetId, "assetId"));
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#request("close", undefined, true).catch(() => {});
    } finally {
      await this.#worker.terminate();
      this.#failAll(new Error("catalog is closed"));
    }
  }

  #request(method, arg, allowWhenClosed = false) {
    if (this.#closed && !allowWhenClosed) return Promise.reject(new Error("catalog is closed"));
    if (this.#startupError) return Promise.reject(this.#startupError);
    if (this.#workerError) return Promise.reject(this.#workerError);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, method, args: arg === undefined ? [] : [arg] });
    });
  }

  #onMessage(message) {
    if (message.type === "startup-error") {
      const error = reviveError(message.error);
      this.#startupError = error;
      this.#failAll(error);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) pending.reject(reviveError(message.error));
    else pending.resolve(message.result);
  }

  #failAll(error) {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}

const normalizeRelativePath = (value) => {
  const text = requiredText(value, "asset.relativePath").normalize("NFC");
  if (path.isAbsolute(text) || text.includes("\0")) {
    throw new TypeError("asset.relativePath must be a safe relative path");
  }
  const normalized = path.normalize(text);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new TypeError("asset.relativePath must stay inside its source root");
  }
  return normalized.normalize("NFC");
};

const requiredAbsolutePath = (value, label) => {
  const text = requiredText(value, label).normalize("NFC");
  if (!path.isAbsolute(text) || text.includes("\0")) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return path.normalize(text);
};

const requiredText = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};

const optionalText = (value, label) => {
  if (value == null) return null;
  return requiredText(value, label);
};

const enumValue = (value, allowed, label) => {
  if (!allowed.has(value)) throw new TypeError(`${label} has an unsupported value`);
  return value;
};

const nonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const reviveError = (value) => {
  const error = new Error(value?.message ?? "catalog worker failed");
  error.name = value?.name ?? "Error";
  if (value?.code) error.code = value.code;
  return error;
};

module.exports = { MediaCatalog, normalizeRelativePath };
