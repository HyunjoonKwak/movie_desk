"use strict";

// Gather referenced originals into one folder. The order is fixed and the
// reason is that a half-finished move loses data: copy, verify the copy is
// byte-identical, only then re-point the reference, and never delete the
// original. See docs/decisions/2026-09-08-library-model.md.

const fs = require("node:fs");
const path = require("node:path");

const consolidateError = (code, message) => Object.assign(new Error(message), { code });

const uniqueDestination = async (directory, fileName) => {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = attempt === 0 ? fileName : `${base} ${attempt}${extension}`;
    const target = path.join(directory, candidate);
    try {
      await fs.promises.access(target);
    } catch {
      return { candidate, target };
    }
  }
  throw consolidateError("NO_FREE_NAME", "could not find an unused name in the destination");
};

const createConsolidator = ({ catalog, helper, resolveSource, registerRootFor }) => ({
  /**
   * Copies each asset into `destinationDirectory` and re-points it only after
   * the copy verifies. Originals are left untouched; deleting them is a
   * separate decision the user makes afterwards.
   */
  async consolidate(assetIds, destinationDirectory, { signal, onProgress } = {}) {
    if (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== "string")) {
      throw consolidateError("INVALID_REQUEST", "consolidate requires a list of asset ids");
    }
    if (typeof destinationDirectory !== "string" || !path.isAbsolute(destinationDirectory)) {
      throw consolidateError("INVALID_REQUEST", "consolidate requires an absolute destination");
    }
    const destinationStat = await fs.promises.stat(destinationDirectory).catch(() => null);
    if (!destinationStat?.isDirectory()) {
      throw consolidateError("DESTINATION_MISSING", "the destination folder does not exist");
    }

    const moved = [];
    const failed = [];
    for (const [index, assetId] of assetIds.entries()) {
      if (signal?.aborted) break;
      onProgress?.({ index, total: assetIds.length, assetId });
      try {
        const asset = await catalog.getAsset(assetId);
        if (!asset) throw consolidateError("ASSET_MISSING", "the asset is no longer in the catalog");
        const resolved = await resolveSource(asset);
        if (resolved.state !== "online") {
          throw consolidateError("SOURCE_OFFLINE", "the original is not currently reachable");
        }
        const sourcePath = resolved.absolutePath;
        const sourceDirectory = path.dirname(sourcePath);
        // Copying a file onto itself would truncate it.
        if (path.resolve(sourceDirectory) === path.resolve(destinationDirectory)) {
          moved.push({ assetId, alreadyThere: true });
          continue;
        }

        const { candidate, target } = await uniqueDestination(
          destinationDirectory,
          path.basename(sourcePath),
        );
        // Copy to a temporary name first so an interrupted run never leaves a
        // short file wearing the real name.
        const staging = `${target}.partial`;
        await fs.promises.copyFile(sourcePath, staging);
        let verifiedHash;
        try {
          const [sourceHash, copyHash] = await Promise.all([
            helper.request("fingerprint", { path: sourcePath, mode: "full" }),
            helper.request("fingerprint", { path: staging, mode: "full" }),
          ]);
          if (sourceHash.hash !== copyHash.hash) {
            throw consolidateError("VERIFY_FAILED", "the copy does not match the original");
          }
          verifiedHash = copyHash.hash;
          await fs.promises.rename(staging, target);
        } catch (error) {
          await fs.promises.rm(staging, { force: true }).catch(() => {});
          throw error;
        }

        // Only now is the reference safe to move.
        const copyStat = await fs.promises.stat(target);
        const rootId = await registerRootFor(target);
        await catalog.upsertAsset({
          ...asset,
          rootId,
          relativePath: candidate,
          sizeBytes: Number(copyStat.size),
          modifiedAtMs: Math.trunc(copyStat.mtimeMs),
          inode: copyStat.ino == null ? undefined : String(copyStat.ino),
          fullHash: verifiedHash,
        });
        moved.push({ assetId, relativePath: candidate });
      } catch (error) {
        failed.push({
          assetId,
          code: typeof error?.code === "string" ? error.code : "CONSOLIDATE_FAILED",
        });
      }
    }
    // The originals are still where they were; this call never deletes.
    return { moved, failed, cancelled: Boolean(signal?.aborted) };
  },
});

module.exports = { createConsolidator, uniqueDestination };
