const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SOURCE_STATES,
  isPathInside,
  resolveAssetSource,
  toDiskSourceRef,
} = require("./source-resolver.cjs");

const temporaryDirectories = new Set();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const fixture = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-source-"));
  temporaryDirectories.add(root);
  const absolutePath = path.join(root, "day-01", "clip.mov");
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "movie-data");
  const fileStat = await fs.promises.stat(absolutePath);
  return {
    root,
    absolutePath,
    asset: {
      id: "asset-1",
      rootId: "root-1",
      relativePath: path.join("day-01", "clip.mov"),
      sizeBytes: fileStat.size,
      modifiedAtMs: Math.trunc(fileStat.mtimeMs),
      inode: String(fileStat.ino),
      quickHash: "quick-1",
      mime: "video/quicktime",
      root: {
        volumeUuid: "volume-1",
        volumeRelativePath: "Media",
        lastKnownAbsolutePath: root,
      },
    },
  };
};

describe("resolveAssetSource", () => {
  it("implements all six source states without silently substituting media", async () => {
    assert.deepEqual([...SOURCE_STATES].sort(), [
      "ambiguous",
      "changed",
      "moved",
      "offline",
      "online",
      "permission-denied",
    ]);

    const onlineFixture = await fixture();
    assert.equal((await resolveAssetSource(onlineFixture.asset)).state, "online");

    fs.appendFileSync(onlineFixture.absolutePath, "changed");
    assert.equal((await resolveAssetSource(onlineFixture.asset)).state, "changed");

    const movedFixture = await fixture();
    const movedPath = path.join(movedFixture.root, "renamed.mov");
    fs.renameSync(movedFixture.absolutePath, movedPath);
    const moved = await resolveAssetSource(movedFixture.asset, {
      candidates: [{ absolutePath: movedPath, quickHash: "quick-1" }],
    });
    assert.equal(moved.state, "moved");
    assert.equal(moved.absolutePath, await fs.promises.realpath(movedPath));

    const inodeOnly = await resolveAssetSource(movedFixture.asset, { candidates: [movedPath] });
    assert.equal(inodeOnly.state, "ambiguous");

    const offlineFixture = await fixture();
    fs.rmSync(offlineFixture.absolutePath);
    assert.equal((await resolveAssetSource(offlineFixture.asset)).state, "offline");

    const deniedFixture = await fixture();
    const denied = await resolveAssetSource(deniedFixture.asset, {
      stat: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    });
    assert.equal(denied.state, "permission-denied");

    const ambiguousFixture = await fixture();
    fs.rmSync(ambiguousFixture.absolutePath);
    const candidateA = path.join(ambiguousFixture.root, "candidate-a.mov");
    const candidateB = path.join(ambiguousFixture.root, "candidate-b.mov");
    fs.writeFileSync(candidateA, "movie-data");
    fs.writeFileSync(candidateB, "movie-data");
    const ambiguous = await resolveAssetSource(ambiguousFixture.asset, {
      candidates: [
        { absolutePath: candidateA, quickHash: "quick-1" },
        { absolutePath: candidateB, quickHash: "quick-1" },
      ],
    });
    assert.equal(ambiguous.state, "ambiguous");
    assert.equal(ambiguous.candidates.length, 2);
  });

  it("rejects a symlink that escapes the registered root", async () => {
    const media = await fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-outside-"));
    temporaryDirectories.add(outside);
    const outsideFile = path.join(outside, "outside.mov");
    fs.writeFileSync(outsideFile, "movie-data");
    fs.rmSync(media.absolutePath);
    fs.symlinkSync(outsideFile, media.absolutePath);

    const resolved = await resolveAssetSource(media.asset);
    assert.equal(resolved.state, "permission-denied");
    assert.equal(resolved.reason, "outside-root");
  });
});

describe("source reference helpers", () => {
  it("keeps absolute paths out of the asset-relative path", async () => {
    const media = await fixture();
    const sourceRef = toDiskSourceRef(media.asset);
    assert.equal(sourceRef.kind, "disk");
    assert.equal(sourceRef.version, 1);
    assert.equal(sourceRef.rootId, "root-1");
    assert.equal(sourceRef.relativePath, path.join("day-01", "clip.mov"));
    assert.equal(sourceRef.rootSnapshot.lastKnownAbsolutePath, media.root);
    assert.equal(isPathInside(media.root, media.absolutePath), true);
    assert.equal(isPathInside(media.root, path.join(media.root, "..", "secret.mov")), false);
  });
});
