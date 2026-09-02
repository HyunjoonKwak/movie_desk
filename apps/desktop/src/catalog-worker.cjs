const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { SCHEMA_SQL, SCHEMA_VERSION } = require("./catalog-schema.cjs");

if (!parentPort) throw new Error("catalog-worker must run in a worker thread");

let database;

const open = () => {
  if (database) return;
  database = new DatabaseSync(workerData.databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  const currentVersion = database.prepare("PRAGMA user_version").get().user_version;
  if (currentVersion > SCHEMA_VERSION) {
    throw Object.assign(
      new Error(`catalog schema ${currentVersion} is newer than supported ${SCHEMA_VERSION}`),
      { code: "CATALOG_TOO_NEW" },
    );
  }
  database.exec(SCHEMA_SQL);
  if (currentVersion < SCHEMA_VERSION) {
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
};

const requireDatabase = () => {
  if (!database) throw new Error("catalog is closed");
  return database;
};

const handlers = {
  ready() {
    const db = requireDatabase();
    return {
      schemaVersion: db.prepare("PRAGMA user_version").get().user_version,
      journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode,
    };
  },

  registerRoot(root) {
    const db = requireDatabase();
    db.prepare(`
      INSERT INTO source_roots (
        id, kind, volume_uuid, volume_relative_path, last_known_absolute_path,
        case_sensitive, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        volume_uuid = excluded.volume_uuid,
        volume_relative_path = excluded.volume_relative_path,
        last_known_absolute_path = excluded.last_known_absolute_path,
        case_sensitive = excluded.case_sensitive,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      root.id,
      root.kind,
      root.volumeUuid,
      root.volumeRelativePath,
      root.lastKnownAbsolutePath,
      root.caseSensitive ? 1 : 0,
      root.createdAtMs,
      root.updatedAtMs,
    );
    return handlers.getRoot(root.id);
  },

  getRoot(rootId) {
    const row = requireDatabase()
      .prepare(`
        SELECT id, kind, volume_uuid, volume_relative_path,
          last_known_absolute_path, case_sensitive, created_at_ms, updated_at_ms
        FROM source_roots WHERE id = ?
      `)
      .get(rootId);
    return row ? mapRoot(row) : null;
  },

  upsertAsset(asset) {
    const db = requireDatabase();
    db.prepare(`
      INSERT INTO media_assets (
        id, root_id, relative_path, relative_path_key, size_bytes, modified_at_ms,
        inode, quick_hash, full_hash, mime, media_kind, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        root_id = excluded.root_id,
        relative_path = excluded.relative_path,
        relative_path_key = excluded.relative_path_key,
        size_bytes = excluded.size_bytes,
        modified_at_ms = excluded.modified_at_ms,
        inode = excluded.inode,
        quick_hash = excluded.quick_hash,
        full_hash = excluded.full_hash,
        mime = excluded.mime,
        media_kind = excluded.media_kind,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      asset.id,
      asset.rootId,
      asset.relativePath,
      asset.relativePathKey,
      asset.sizeBytes,
      asset.modifiedAtMs,
      asset.inode,
      asset.quickHash,
      asset.fullHash,
      asset.mime,
      asset.mediaKind,
      asset.createdAtMs,
      asset.updatedAtMs,
    );
    return handlers.getAsset(asset.id);
  },

  getAsset(assetId) {
    const row = requireDatabase()
      .prepare(`
        SELECT
          a.id, a.root_id, a.relative_path, a.size_bytes, a.modified_at_ms,
          a.inode, a.quick_hash, a.full_hash, a.mime, a.media_kind,
          r.kind AS root_kind, r.volume_uuid, r.volume_relative_path,
          r.last_known_absolute_path, r.case_sensitive
        FROM media_assets a
        JOIN source_roots r ON r.id = a.root_id
        WHERE a.id = ?
      `)
      .get(assetId);
    return row ? mapAsset(row) : null;
  },

  getAssetByLocation(location) {
    const row = requireDatabase()
      .prepare(`
        SELECT
          a.id, a.root_id, a.relative_path, a.size_bytes, a.modified_at_ms,
          a.inode, a.quick_hash, a.full_hash, a.mime, a.media_kind,
          r.kind AS root_kind, r.volume_uuid, r.volume_relative_path,
          r.last_known_absolute_path, r.case_sensitive
        FROM media_assets a
        JOIN source_roots r ON r.id = a.root_id
        WHERE a.root_id = ? AND a.relative_path_key = ?
      `)
      .get(location.rootId, location.relativePathKey);
    return row ? mapAsset(row) : null;
  },

  setUserMetadata(metadata) {
    const db = requireDatabase();
    db.prepare(`
      INSERT INTO asset_user_metadata (
        asset_id, rating, tags_json, note, decision, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        rating = excluded.rating,
        tags_json = excluded.tags_json,
        note = excluded.note,
        decision = excluded.decision,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      metadata.assetId,
      metadata.rating,
      JSON.stringify(metadata.tags),
      metadata.note,
      metadata.decision,
      metadata.updatedAtMs,
    );
    return handlers.getUserMetadata(metadata.assetId);
  },

  getUserMetadata(assetId) {
    const row = requireDatabase()
      .prepare(`
        SELECT asset_id, rating, tags_json, note, decision, updated_at_ms
        FROM asset_user_metadata WHERE asset_id = ?
      `)
      .get(assetId);
    if (!row) return null;
    return {
      assetId: row.asset_id,
      rating: row.rating,
      tags: JSON.parse(row.tags_json),
      note: row.note,
      decision: row.decision,
      updatedAtMs: row.updated_at_ms,
    };
  },

  close() {
    if (database) {
      database.close();
      database = undefined;
    }
    return null;
  },
};

const mapRoot = (row) => ({
  id: row.id,
  kind: row.kind,
  volumeUuid: row.volume_uuid,
  volumeRelativePath: row.volume_relative_path,
  lastKnownAbsolutePath: row.last_known_absolute_path,
  caseSensitive: row.case_sensitive === 1,
  createdAtMs: row.created_at_ms,
  updatedAtMs: row.updated_at_ms,
});

const mapAsset = (row) => ({
  id: row.id,
  rootId: row.root_id,
  relativePath: row.relative_path,
  sizeBytes: row.size_bytes,
  modifiedAtMs: row.modified_at_ms,
  inode: row.inode,
  quickHash: row.quick_hash,
  fullHash: row.full_hash,
  mime: row.mime,
  mediaKind: row.media_kind,
  root: {
    id: row.root_id,
    kind: row.root_kind,
    volumeUuid: row.volume_uuid,
    volumeRelativePath: row.volume_relative_path,
    lastKnownAbsolutePath: row.last_known_absolute_path,
    caseSensitive: row.case_sensitive === 1,
  },
});

try {
  open();
} catch (error) {
  parentPort.postMessage({ type: "startup-error", error: serializeError(error) });
}

parentPort.on("message", ({ id, method, args = [] }) => {
  try {
    const handler = handlers[method];
    if (!handler) throw new Error(`unknown catalog method: ${method}`);
    parentPort.postMessage({ id, result: handler(...args) });
  } catch (error) {
    parentPort.postMessage({ id, error: serializeError(error) });
  }
});

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
  };
}
