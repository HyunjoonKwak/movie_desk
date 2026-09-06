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

const createCatalogSnapshot = async (catalog, directory) => {
  await fs.mkdir(directory, { recursive: true });
  const name = `snapshot-${Date.now()}-${crypto.randomUUID()}.sqlite3`;
  const temporary = path.join(directory, `.${name}.tmp`);
  const destination = path.join(directory, name);
  try {
    await catalog.snapshot(temporary);
    await validateSnapshot(temporary);
    await fs.rename(temporary, destination);
    // Keep the last seven successful snapshots. Failed snapshots never rotate good ones.
    const snapshots = await listCatalogSnapshots(directory);
    for (const old of snapshots.slice(7)) await fs.rm(path.join(directory, old));
    return destination;
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

const listCatalogSnapshots = async (directory) => {
  try {
    return (await fs.readdir(directory))
      .filter((name) => /^snapshot-\d+-[a-f0-9-]+\.sqlite3$/.test(name))
      .sort()
      .reverse();
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
    return { preservedDirectory };
  } catch (error) {
    for (const { source, saved } of moved.reverse()) await fs.rename(saved, source);
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

module.exports = {
  createCatalogSnapshot,
  listCatalogSnapshots,
  restoreCatalogSnapshot,
  validateSnapshot,
};
