const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MediaCatalog } = require("./catalog.cjs");
const {
  createCatalogSnapshot,
  restoreCatalogSnapshot,
  listCatalogSnapshots,
  validateSnapshot,
} = require("./catalog-backup.cjs");

test("WAL snapshot restores source identity and user metadata with explicit consent", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-backup-"));
  const databasePath = path.join(dir, "media.sqlite3");
  let catalog = new MediaCatalog(databasePath);
  t.after(async () => {
    await catalog.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await catalog.ready();
  await catalog.registerRoot({ id: "r", kind: "local", lastKnownAbsolutePath: dir });
  await catalog.upsertAsset({
    id: "a",
    rootId: "r",
    relativePath: "video.mp4",
    sizeBytes: 2,
    modifiedAtMs: 3,
  });
  await catalog.setUserMetadata({ assetId: "a", note: "precious", tags: ["trip"] });
  const snapshotPath = await createCatalogSnapshot(catalog, path.join(dir, "backups"));
  await catalog.setUserMetadata({ assetId: "a", note: "later" });
  await catalog.close();
  const before = await fs.readFile(databasePath);
  await assert.rejects(restoreCatalogSnapshot({ databasePath, snapshotPath }), /confirmation/);
  assert.deepEqual(await fs.readFile(databasePath), before);
  const { preservedDirectory } = await restoreCatalogSnapshot({
    databasePath,
    snapshotPath,
    confirmed: true,
  });
  assert.deepEqual(await fs.readFile(path.join(preservedDirectory, "media.sqlite3")), before);
  catalog = new MediaCatalog(databasePath);
  await catalog.ready();
  assert.equal((await catalog.getUserMetadata("a")).note, "precious");
  assert.equal((await catalog.getAsset("a")).relativePath, "video.mp4");
});

test("corrupt snapshot never replaces catalog; failed backup leaves good snapshots intact", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-backup-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "media.sqlite3");
  const snapshotPath = path.join(dir, "bad.sqlite3");
  await fs.writeFile(databasePath, "current catalog");
  await fs.writeFile(snapshotPath, "damaged");
  await assert.rejects(validateSnapshot(snapshotPath));
  await assert.rejects(restoreCatalogSnapshot({ databasePath, snapshotPath, confirmed: true }));
  assert.equal(await fs.readFile(databasePath, "utf8"), "current catalog");
  const backups = path.join(dir, "backups");
  await fs.mkdir(backups);
  await fs.writeFile(path.join(backups, "snapshot-100-abc.sqlite3"), "good");
  await assert.rejects(
    createCatalogSnapshot(
      {
        snapshot: async () => {
          throw new Error("disk full");
        },
      },
      backups,
    ),
    /disk full/,
  );
  assert.deepEqual(await listCatalogSnapshots(backups), ["snapshot-100-abc.sqlite3"]);
});
