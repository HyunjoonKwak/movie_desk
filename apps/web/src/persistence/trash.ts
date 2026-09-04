// The media trash: asset records removed from a project, kept in IndexedDB
// so they can be put back. Their OPFS copies stay alive because media GC
// treats trash rows as references (see media-gc.ts) until an entry is
// restored, deleted for good, or expires.

import Dexie, { type Table } from "dexie";
import type { ID, MediaAsset } from "@movie-desk/core";
import { mediaAssetSchema } from "./project-export";

export interface TrashEntry {
  readonly id: string; // asset id
  readonly projectId: string;
  readonly name: string;
  readonly kind: MediaAsset["kind"];
  readonly deletedAt: number;
  readonly json: string; // serialized MediaAsset
}

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class TrashDB extends Dexie {
  trash!: Table<TrashEntry, string>;
  constructor() {
    // Legacy naming, like the other stores, so a rename never hides data.
    super("cut_editor.trash.v1");
    this.version(1).stores({ trash: "id, projectId, deletedAt" });
  }
}

let db: TrashDB | null = null;
const getDb = () => {
  if (!db) db = new TrashDB();
  return db;
};

export const moveAssetToTrash = async (projectId: ID, asset: MediaAsset): Promise<void> => {
  await getDb().trash.put({
    id: asset.id,
    projectId,
    name: asset.name,
    kind: asset.kind,
    deletedAt: Date.now(),
    json: JSON.stringify(asset),
  });
};

export const listTrash = async (projectId: ID): Promise<readonly TrashEntry[]> =>
  getDb().trash.where("projectId").equals(projectId).reverse().sortBy("deletedAt");

export const countTrash = async (projectId: ID): Promise<number> =>
  getDb().trash.where("projectId").equals(projectId).count();

// The asset record of a trash entry, or null when the row is damaged.
export const readTrashedAsset = async (id: string): Promise<MediaAsset | null> => {
  const row = await getDb().trash.get(id);
  if (!row) return null;
  try {
    return mediaAssetSchema.parse(JSON.parse(row.json)) as unknown as MediaAsset;
  } catch {
    return null;
  }
};

export const deleteTrashEntry = async (id: string): Promise<void> => {
  await getDb().trash.delete(id);
};

export const emptyTrash = async (projectId: ID): Promise<void> => {
  await getDb().trash.where("projectId").equals(projectId).delete();
};

// Every OPFS key a trash entry still needs, dropping entries past retention
// on the way (their files become garbage for this pass).
export const trashMediaKeys = async (keep: Set<string>, now = Date.now()): Promise<void> => {
  const rows = await getDb().trash.toArray();
  for (const row of rows) {
    if (now - row.deletedAt > TRASH_RETENTION_MS) {
      await getDb().trash.delete(row.id);
      continue;
    }
    try {
      const asset = JSON.parse(row.json) as Partial<MediaAsset>;
      if (asset.opfsPath) keep.add(asset.opfsPath);
      if (asset.proxyPath) keep.add(asset.proxyPath);
    } catch {
      // A damaged row keeps nothing alive; it is removed at restore time.
    }
  }
};
