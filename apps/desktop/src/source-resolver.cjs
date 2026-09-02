const fs = require("node:fs");
const path = require("node:path");

const SOURCE_STATES = new Set([
  "online",
  "moved",
  "changed",
  "offline",
  "permission-denied",
  "ambiguous",
]);

const resolveAssetSource = async (
  asset,
  {
    rootPath = asset?.root?.lastKnownAbsolutePath,
    candidates = [],
    stat = fs.promises.stat,
    realpath = fs.promises.realpath,
  } = {},
) => {
  if (!asset || typeof asset !== "object") throw new TypeError("asset is required");
  if (!path.isAbsolute(rootPath ?? "")) throw new TypeError("rootPath must be absolute");
  const absolutePath = path.resolve(rootPath, asset.relativePath);
  if (!isPathInside(rootPath, absolutePath)) {
    return result("permission-denied", { reason: "outside-root" });
  }

  try {
    const [rootRealPath, fileRealPath, fileStat] = await Promise.all([
      realpath(rootPath),
      realpath(absolutePath),
      stat(absolutePath),
    ]);
    if (!isPathInside(rootRealPath, fileRealPath)) {
      return result("permission-denied", { reason: "outside-root" });
    }
    if (!fileStat.isFile()) return result("changed", { reason: "not-a-file" });
    const current = statFingerprint(fileStat);
    if (matchesFastFingerprint(asset, current)) {
      return result("online", { absolutePath: fileRealPath, fingerprint: current });
    }
    return result("changed", {
      absolutePath: fileRealPath,
      expected: expectedFingerprint(asset),
      fingerprint: current,
    });
  } catch (error) {
    if (isPermissionError(error)) {
      return result("permission-denied", { reason: error.code });
    }
    if (!isMissingError(error)) throw error;
  }

  const matches = [];
  let sawPermissionError = false;
  for (const candidate of candidates) {
    const candidatePath = typeof candidate === "string" ? candidate : candidate?.absolutePath;
    if (!path.isAbsolute(candidatePath ?? "") || !isPathInside(rootPath, candidatePath)) continue;
    try {
      const [rootRealPath, fileRealPath, fileStat] = await Promise.all([
        realpath(rootPath),
        realpath(candidatePath),
        stat(candidatePath),
      ]);
      if (!isPathInside(rootRealPath, fileRealPath) || !fileStat.isFile()) continue;
      const fingerprint = {
        ...statFingerprint(fileStat),
        quickHash: typeof candidate === "object" ? candidate.quickHash : undefined,
        fullHash: typeof candidate === "object" ? candidate.fullHash : undefined,
      };
      const confidence = movedFingerprintConfidence(asset, fingerprint);
      if (confidence) {
        matches.push({ absolutePath: fileRealPath, fingerprint, confidence });
      }
    } catch (error) {
      if (isPermissionError(error)) sawPermissionError = true;
      else if (!isMissingError(error)) throw error;
    }
  }

  const verified = matches.filter((candidate) => candidate.confidence === "verified");
  if (verified.length === 1) return result("moved", verified[0]);
  if (matches.length > 0) return result("ambiguous", { candidates: matches });
  if (sawPermissionError) return result("permission-denied", { reason: "candidate-permission" });
  return result("offline", { expectedPath: absolutePath });
};

const toDiskSourceRef = (asset) => ({
  kind: "disk",
  version: 1,
  rootId: asset.rootId,
  rootSnapshot: {
    ...(asset.root.volumeUuid ? { volumeUuid: asset.root.volumeUuid } : {}),
    ...(asset.root.volumeRelativePath ? { volumeRelativePath: asset.root.volumeRelativePath } : {}),
    ...(asset.root.lastKnownAbsolutePath
      ? { lastKnownAbsolutePath: asset.root.lastKnownAbsolutePath }
      : {}),
  },
  relativePath: asset.relativePath,
  sizeBytes: asset.sizeBytes,
  modifiedAtMs: asset.modifiedAtMs,
  ...(asset.inode ? { inode: asset.inode } : {}),
  ...(asset.quickHash ? { quickHash: asset.quickHash } : {}),
  ...(asset.fullHash ? { fullHash: asset.fullHash } : {}),
});

const statFingerprint = (value) => ({
  sizeBytes: Number(value.size),
  modifiedAtMs: Math.trunc(value.mtimeMs),
  inode: value.ino == null ? undefined : String(value.ino),
});

const expectedFingerprint = (asset) => ({
  sizeBytes: asset.sizeBytes,
  modifiedAtMs: asset.modifiedAtMs,
  inode: asset.inode,
  quickHash: asset.quickHash,
  fullHash: asset.fullHash,
});

const matchesFastFingerprint = (asset, current) =>
  asset.sizeBytes === current.sizeBytes &&
  Math.trunc(asset.modifiedAtMs) === Math.trunc(current.modifiedAtMs);

const movedFingerprintConfidence = (asset, current) => {
  if (asset.sizeBytes !== current.sizeBytes) return false;
  if (asset.fullHash) {
    if (current.fullHash) return asset.fullHash === current.fullHash ? "verified" : false;
    return asset.inode && current.inode && asset.inode === current.inode ? "candidate" : false;
  }
  if (asset.quickHash) {
    if (current.quickHash) return asset.quickHash === current.quickHash ? "verified" : false;
    return asset.inode && current.inode && asset.inode === current.inode ? "candidate" : false;
  }
  return asset.inode && current.inode && asset.inode === current.inode ? "candidate" : false;
};

const isPathInside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isMissingError = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR";
const isPermissionError = (error) => error?.code === "EACCES" || error?.code === "EPERM";

const result = (state, details = {}) => {
  if (!SOURCE_STATES.has(state)) throw new Error(`unsupported source state: ${state}`);
  return { state, ...details };
};

module.exports = {
  SOURCE_STATES,
  isPathInside,
  resolveAssetSource,
  toDiskSourceRef,
};
