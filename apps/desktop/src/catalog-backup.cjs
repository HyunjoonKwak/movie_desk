const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { MediaCatalog } = require("./catalog.cjs");

const validateSnapshot = async (file) => {
  const catalog = new MediaCatalog(file, { readOnly: true });
  try {
    await catalog.ready();
  } finally {
    await catalog.close();
  }
};

const revisions = new WeakMap();
const retainedSnapshots = (names) => {
  const sorted = [...names].sort((a, b) => snapshotTime(b) - snapshotTime(a));
  const keep = new Set(sorted.slice(0, 3));
  for (const [period, count] of [[3_600_000, 2], [86_400_000, 2]]) {
    const buckets = new Set([...keep].map((name) => Math.floor(snapshotTime(name) / period)));
    let added = 0;
    for (const name of sorted) {
      const bucket = Math.floor(snapshotTime(name) / period);
      if (!buckets.has(bucket) && added < count) { keep.add(name); buckets.add(bucket); added++; }
    }
  }
  return keep;
};
const snapshotTime = (name) => Number(name.split("-")[1]);

const createCatalogSnapshot = async (catalog, directory) => {
  const token = await catalog.changeToken?.();
  if (token !== undefined && revisions.get(catalog)?.token === token) return revisions.get(catalog).destination;
  await fs.mkdir(directory, { recursive: true });
  const name = `snapshot-${Date.now()}-${crypto.randomUUID()}.sqlite3`;
  const temporary = path.join(directory, `.${name}.tmp`);
  const destination = path.join(directory, name);
  try {
    await catalog.snapshot(temporary);
    await validateSnapshot(temporary);
    await fs.rename(temporary, destination);
    revisions.set(catalog, { token, destination });
    // Three recent, two hourly and two daily generations; rotate only after success.
    const snapshots = await listCatalogSnapshots(directory);
    const retained = retainedSnapshots(snapshots);
    for (const old of snapshots) if (!retained.has(old)) await fs.rm(path.join(directory, old));
    return destination;
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

const listCatalogSnapshots = async (directory) => {
  try {
    return (await fs.readdir(directory))
      .filter((name) => /^snapshot-\d+-[a-f0-9-]+\.sqlite3$/.test(name))
      .sort((a, b) => snapshotTime(b) - snapshotTime(a));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

// Caller must first close the worker and obtain explicit user confirmation.
// Preserve the entire previous DB/WAL/SHM set for recovery; touch no media files.
const restoreCatalogSnapshot = async ({ databasePath, snapshotPath, confirmed }) => {
  if (confirmed !== true) throw new Error("Catalog restoration requires confirmation");
  const temporary = `${databasePath}.restore-${crypto.randomUUID()}`;
  const preservedDirectory = `${databasePath}.before-restore-${crypto.randomUUID()}`;
  await fs.copyFile(snapshotPath, temporary, fs.constants.COPYFILE_EXCL);
  const moved = [];
  try {
    await validateSnapshot(temporary);
    await fs.mkdir(preservedDirectory);
    for (const suffix of ["", "-wal", "-shm"]) {
      const source = `${databasePath}${suffix}`;
      const saved = path.join(preservedDirectory, `media.sqlite3${suffix}`);
      try {
        await fs.rename(source, saved);
        moved.push({ source, saved });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await fs.rename(temporary, databasePath);
    // A cleanup failure must not roll back an already restored database.
    await prunePreserved(databasePath).catch(() => {});
    return { preservedDirectory };
  } catch (error) {
    for (const { source, saved } of moved.reverse()) await fs.rename(saved, source);
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

const prunePreserved = async (databasePath) => {
  const directory = path.dirname(databasePath);
  const prefix = `${path.basename(databasePath)}.before-restore-`;
  const entries = await Promise.all((await fs.readdir(directory)).filter((name) => name.startsWith(prefix)).map(async (name) => ({ name, stat: await fs.stat(path.join(directory, name)) })));
  entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  for (const entry of entries.slice(2)) await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
};

module.exports = {
  retainedSnapshots,
  createCatalogSnapshot,
  listCatalogSnapshots,
  restoreCatalogSnapshot,
  validateSnapshot,
};
