const path = require("node:path");
const { isPathInside, resolveAssetSource } = require("./source-resolver.cjs");

class VolumeRootResolver {
  #helper;
  #resolveSource;
  #cacheTtlMs;
  #mounts = new Map();

  constructor({ helper, resolveSource = resolveAssetSource, cacheTtlMs = 10_000 }) {
    if (!helper || typeof helper.request !== "function") throw new TypeError("helper is required");
    this.#helper = helper;
    this.#resolveSource = resolveSource;
    this.#cacheTtlMs = cacheTtlMs;
  }

  async resolve(asset, options = {}) {
    const root = asset?.root;
    if (!root) return { state: "offline", reason: "root-missing" };
    let rootPath = root.lastKnownAbsolutePath;

    if (root.volumeUuid) {
      if (typeof root.volumeRelativePath !== "string") {
        return { state: "offline", reason: "volume-relative-path-missing" };
      }
      try {
        const mountPoint = await this.#mountPoint(root.volumeUuid);
        const candidate = path.resolve(mountPoint, root.volumeRelativePath);
        if (path.isAbsolute(root.volumeRelativePath) || !isPathInside(mountPoint, candidate)) {
          return { state: "permission-denied", reason: "outside-volume" };
        }
        rootPath = candidate;
      } catch (error) {
        return { state: "offline", reason: error?.code ?? "volume-offline" };
      }
    }

    if (!path.isAbsolute(rootPath ?? "")) return { state: "offline", reason: "root-unavailable" };
    return this.#resolveSource(asset, { ...options, rootPath });
  }

  clear() {
    this.#mounts.clear();
  }

  async #mountPoint(volumeUuid) {
    const cached = this.#mounts.get(volumeUuid);
    if (cached && cached.expiresAt > Date.now()) return cached.mountPoint;
    const resolved = await this.#helper.request("volume-mount", { volumeUuid });
    if (!resolved || !path.isAbsolute(resolved.mountPoint ?? "")) {
      throw Object.assign(new Error("volume is not mounted"), { code: "VOLUME_NOT_FOUND" });
    }
    this.#mounts.set(volumeUuid, {
      mountPoint: resolved.mountPoint,
      expiresAt: Date.now() + this.#cacheTtlMs,
    });
    return resolved.mountPoint;
  }
}

module.exports = { VolumeRootResolver };
