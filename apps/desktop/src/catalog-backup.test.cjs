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
  retainedSnapshots,
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

test("unchanged catalogs skip snapshots; source status only writes transitions", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-revision-"));
  const catalog = new MediaCatalog(path.join(dir, "catalog.sqlite3"));
  t.after(async () => { await catalog.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await catalog.ready();
  await catalog.registerRoot({ id: "r", kind: "local", lastKnownAbsolutePath: dir });
  await catalog.upsertAsset({ id: "a", rootId: "r", relativePath: "a.mov", sizeBytes: 1, modifiedAtMs: 1 });
  const backups = path.join(dir, "backups");
  const first = await createCatalogSnapshot(catalog, backups);
  assert.equal(await createCatalogSnapshot(catalog, backups), first);
  await catalog.recordSourceState("a", "offline");
  const revision = await catalog.changeToken();
  await catalog.recordSourceState("a", "offline");
  assert.equal(await catalog.changeToken(), revision);
  assert.deepEqual(await catalog.lastSourceStates(["a"]), { a: "offline" });
  assert.notEqual(await createCatalogSnapshot(catalog, backups), first);
});

test("retention keeps at most seven snapshots across recent, hourly and daily generations", () => {
  const now = 10 * 86_400_000;
  const names = Array.from({ length: 800 }, (_, i) => `snapshot-${now - i * 900_000}-abc.sqlite3`);
  const kept = retainedSnapshots(names);
  assert.equal(kept.size, 7);
  for (const name of names.slice(0, 3)) assert.ok(kept.has(name));
  assert.ok([...kept].some((name) => Number(name.split("-")[1]) <= now - 86_400_000));
});

test("successful snapshot removes obsolete generations from disk", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-retention-"));
  const catalog = new MediaCatalog(path.join(dir, "catalog.sqlite3"));
  t.after(async () => { await catalog.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await catalog.ready();
  const backups = path.join(dir, "backups");
  await fs.mkdir(backups);
  const now = Date.now();
  for (let i = 1; i <= 12; i++) {
    await fs.writeFile(path.join(backups, `snapshot-${now - i * 86_400_000}-abc.sqlite3`), "old snapshot fixture");
  }
  const newest = await createCatalogSnapshot(catalog, backups);
  const names = await listCatalogSnapshots(backups);
  assert.equal(names.length, 7);
  assert.ok(names.includes(path.basename(newest)));
  assert.deepEqual(new Set(names), retainedSnapshots(names));
});
