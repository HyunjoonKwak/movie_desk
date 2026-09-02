const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS source_roots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'removable', 'network')),
  volume_uuid TEXT,
  volume_relative_path TEXT,
  last_known_absolute_path TEXT NOT NULL,
  case_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (case_sensitive IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES source_roots(id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL,
  relative_path_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  modified_at_ms INTEGER NOT NULL CHECK (modified_at_ms >= 0),
  inode TEXT,
  quick_hash TEXT,
  full_hash TEXT,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  media_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (media_kind IN ('video', 'audio', 'image', 'unknown')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (root_id, relative_path_key)
) STRICT;

CREATE INDEX IF NOT EXISTS media_assets_root_inode
  ON media_assets(root_id, inode) WHERE inode IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_assets_quick_fingerprint
  ON media_assets(size_bytes, quick_hash) WHERE quick_hash IS NOT NULL;

-- User-authored data intentionally lives outside the rebuildable file facts.
CREATE TABLE IF NOT EXISTS asset_user_metadata (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  tags_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  decision TEXT CHECK (decision IS NULL OR decision IN ('accepted', 'rejected')),
  updated_at_ms INTEGER NOT NULL
) STRICT;

-- Cache rows are disposable pointers. Removing this table's contents must not
-- affect source identity or user-authored metadata.
CREATE TABLE IF NOT EXISTS cache_entries (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  variant TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  relative_cache_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (asset_id, fingerprint, variant, pipeline_version)
) STRICT;
`;

module.exports = { SCHEMA_SQL, SCHEMA_VERSION };
