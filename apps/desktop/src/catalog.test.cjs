const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MediaCatalog, normalizeRelativePath } = require("./catalog.cjs");

const catalogs = new Set();
const temporaryDirectories = new Set();

const createCatalog = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-catalog-"));
  temporaryDirectories.add(directory);
  const catalog = new MediaCatalog(path.join(directory, "catalog.sqlite3"));
  catalogs.add(catalog);
  await catalog.ready();
  return catalog;
};

afterEach(async () => {
  await Promise.all([...catalogs].map((catalog) => catalog.close()));
  catalogs.clear();
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("MediaCatalog", () => {
  it("opens WAL schema version 1 in its worker", async () => {
    const catalog = await createCatalog();
    assert.deepEqual(await catalog.ready(), { schemaVersion: 1, journalMode: "wal" });
  });

  it("refuses to overwrite a catalog created by a newer app", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-catalog-"));
    temporaryDirectories.add(directory);
    const databasePath = path.join(directory, "catalog.sqlite3");
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA user_version = 999");
    database.close();
    const catalog = new MediaCatalog(databasePath);
    catalogs.add(catalog);

    await assert.rejects(catalog.ready(), (error) => error.code === "CATALOG_TOO_NEW");
  });

  it("stores source roots and produces an asset with its root snapshot", async () => {
    const catalog = await createCatalog();
    await catalog.registerRoot({
      id: "root-1",
      kind: "removable",
      volumeUuid: "A1B2-C3D4",
      volumeRelativePath: "Movies",
      lastKnownAbsolutePath: "/Volumes/CAMERA/Movies",
      caseSensitive: false,
    });
    const asset = await catalog.upsertAsset({
      id: "asset-1",
      rootId: "root-1",
      relativePath: "Day 01/C001.mov",
      sizeBytes: 1234,
      modifiedAtMs: 5678,
      inode: "42",
      quickHash: "sha256:quick",
      mime: "video/quicktime",
      mediaKind: "video",
    });

    assert.equal(asset.relativePath, path.join("Day 01", "C001.mov"));
    assert.equal(asset.root.volumeUuid, "A1B2-C3D4");
    assert.equal(asset.root.lastKnownAbsolutePath, "/Volumes/CAMERA/Movies");
    assert.equal((await catalog.getAsset("asset-1")).quickHash, "sha256:quick");
    assert.equal((await catalog.getAssetByLocation("root-1", "Day 01/C001.mov")).id, "asset-1");
    assert.equal(await catalog.getAssetByLocation("root-1", "missing.mov"), null);
  });

  it("honors root case sensitivity when enforcing path identity", async () => {
    const catalog = await createCatalog();
    await catalog.registerRoot({
      id: "insensitive",
      kind: "local",
      lastKnownAbsolutePath: "/tmp/media",
      caseSensitive: false,
    });
    await catalog.upsertAsset({
      id: "asset-upper",
      rootId: "insensitive",
      relativePath: "Clip.MOV",
      sizeBytes: 1,
      modifiedAtMs: 1,
    });

    await assert.rejects(
      catalog.upsertAsset({
        id: "asset-lower",
        rootId: "insensitive",
        relativePath: "clip.mov",
        sizeBytes: 1,
        modifiedAtMs: 1,
      }),
      /UNIQUE constraint failed/,
    );
  });

  it("keeps user metadata separate from rebuildable media facts", async () => {
    const catalog = await createCatalog();
    await catalog.registerRoot({
      id: "root-1",
      kind: "local",
      lastKnownAbsolutePath: "/tmp/media",
    });
    await catalog.upsertAsset({
      id: "asset-1",
      rootId: "root-1",
      relativePath: "clip.mov",
      sizeBytes: 1,
      modifiedAtMs: 1,
    });
    await catalog.setUserMetadata({
      assetId: "asset-1",
      rating: 4,
      tags: ["interview", "select"],
      note: "Opening answer",
      decision: "accepted",
    });

    assert.deepEqual(await catalog.getUserMetadata("asset-1"), {
      assetId: "asset-1",
      rating: 4,
      tags: ["interview", "select"],
      note: "Opening answer",
      decision: "accepted",
      updatedAtMs: (await catalog.getUserMetadata("asset-1")).updatedAtMs,
    });
  });
});

describe("normalizeRelativePath", () => {
  it("normalizes Unicode to NFC and rejects traversal", () => {
    assert.equal(normalizeRelativePath("Cafe\u0301/clip.mov"), path.join("Caf\u00e9", "clip.mov"));
    assert.throws(() => normalizeRelativePath("../secret.mov"), /inside its source root/);
    assert.throws(() => normalizeRelativePath("/tmp/secret.mov"), /safe relative path/);
  });
});
