const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VolumeRootResolver } = require("./volume-root-resolver.cjs");

const temporaryDirectories = new Set();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const fixture = async () => {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-volume-"));
  temporaryDirectories.add(mountPoint);
  const rootPath = path.join(mountPoint, "Movies", "Library");
  const absolutePath = path.join(rootPath, "clip.mov");
  fs.mkdirSync(rootPath, { recursive: true });
  fs.writeFileSync(absolutePath, "video");
  const fileStat = await fs.promises.stat(absolutePath);
  return {
    mountPoint,
    asset: {
      relativePath: "clip.mov",
      sizeBytes: fileStat.size,
      modifiedAtMs: Math.trunc(fileStat.mtimeMs),
      root: {
        volumeUuid: "A1B2-C3D4",
        volumeRelativePath: path.join("Movies", "Library"),
        lastKnownAbsolutePath: "/Volumes/OLD/Movies/Library",
      },
    },
  };
};

describe("VolumeRootResolver", () => {
  it("uses volume UUID instead of a stale absolute path and caches the mount briefly", async () => {
    const media = await fixture();
    let calls = 0;
    const helper = {
      request: async () => {
        calls += 1;
        return { mountPoint: media.mountPoint };
      },
    };
    const resolver = new VolumeRootResolver({ helper });

    assert.equal((await resolver.resolve(media.asset)).state, "online");
    assert.equal((await resolver.resolve(media.asset)).state, "online");
    assert.equal(calls, 1);
  });

  it("does not fall back to a lookalike path when the identified volume is offline", async () => {
    const media = await fixture();
    const helper = {
      request: async () => {
        throw Object.assign(new Error("missing"), { code: "VOLUME_NOT_FOUND" });
      },
    };
    const resolver = new VolumeRootResolver({ helper });
    assert.deepEqual(await resolver.resolve(media.asset), {
      state: "offline",
      reason: "VOLUME_NOT_FOUND",
    });
  });

  it("rejects a volume-relative path that escapes its volume", async () => {
    const media = await fixture();
    media.asset.root.volumeRelativePath = "../outside";
    const resolver = new VolumeRootResolver({
      helper: { request: async () => ({ mountPoint: media.mountPoint }) },
    });
    assert.deepEqual(await resolver.resolve(media.asset), {
      state: "permission-denied",
      reason: "outside-volume",
    });
  });
});
