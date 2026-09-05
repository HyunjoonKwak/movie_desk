import {
  hasInlinePreviews,
  inlinePreviewsOf,
  withoutInlinePreviews,
} from "@/media/inline-previews";
import type { ID, MediaAsset, Project } from "@movie-desk/core";
import Dexie, { type Table } from "dexie";
import { type StoredProjectScan, scanStoredProjects } from "./media-gc";
import { listSnapshotJson } from "./snapshots";
import { trashAssetIds } from "./trash";

// Derived previews (thumbnail, filmstrip) live here, keyed by asset id,
// instead of inline in the asset record. Inline data URLs made every
// project save and every Yjs update carry the pictures again (6.9 MB of
// JSON per 1,000 assets in the A5 measurement); a rating change should
// not rewrite a thumbnail. Records written by older builds still carry
// the data URLs and are migrated on load (startInlinePreviewMigration).

export interface Filmstrip {
  readonly dataUrl: string;
  readonly frames: number;
}

export interface AssetPreviews {
  readonly thumb?: string;
  readonly filmstrip?: Filmstrip;
}

export {
  hasInlinePreviews,
  inlinePreviewsOf,
  withoutInlinePreviews,
} from "@/media/inline-previews";

interface PreviewRow {
  id: string; // `${assetId}:${kind}`
  assetId: string;
  kind: "thumb" | "filmstrip";
  dataUrl: string;
  frames?: number;
  updatedAt: number;
}

class PreviewDB extends Dexie {
  previews!: Table<PreviewRow, string>;
  constructor() {
    super("movie-desk.previews.v1");
    this.version(1).stores({ previews: "id, assetId" });
  }
}

let db: PreviewDB | null = null;
const getDb = (): PreviewDB => {
  if (!db) db = new PreviewDB();
  return db;
};

const rowId = (assetId: string, kind: PreviewRow["kind"]): string => `${assetId}:${kind}`;

type StoredListener = (
  assetId: string,
  previews: AssetPreviews,
  options: { readonly replaceMissing: boolean },
) => void;
const listeners = new Set<StoredListener>();
const previewWrites = new Map<string, Promise<boolean>>();

// The in-memory preview store subscribes here so a freshly imported or
// relinked asset shows its picture without a database round trip.
export const onPreviewsStored = (listener: StoredListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const putAssetPreviews = async (
  assetId: string,
  previews: AssetPreviews,
  {
    replaceMissing = true,
    shouldWrite,
  }: { readonly replaceMissing?: boolean; readonly shouldWrite?: () => boolean } = {},
): Promise<boolean> => {
  const updatedAt = Date.now();
  const rows: PreviewRow[] = [];
  if (previews.thumb) {
    rows.push({
      id: rowId(assetId, "thumb"),
      assetId,
      kind: "thumb",
      dataUrl: previews.thumb,
      updatedAt,
    });
  }
  if (previews.filmstrip) {
    rows.push({
      id: rowId(assetId, "filmstrip"),
      assetId,
      kind: "filmstrip",
      dataUrl: previews.filmstrip.dataUrl,
      frames: previews.filmstrip.frames,
      updatedAt,
    });
  }
  const missing: PreviewRow["kind"][] = [];
  if (replaceMissing && !previews.thumb) missing.push("thumb");
  if (replaceMissing && !previews.filmstrip) missing.push("filmstrip");
  const previous = previewWrites.get(assetId) ?? Promise.resolve(true);
  const write = previous
    .catch(() => false)
    .then(async () => {
      if (shouldWrite && !shouldWrite()) return false;
      await getDb().transaction("rw", getDb().previews, async () => {
        if (rows.length > 0) await getDb().previews.bulkPut(rows);
        if (missing.length > 0) {
          await getDb().previews.bulkDelete(missing.map((kind) => rowId(assetId, kind)));
        }
      });
      for (const listener of listeners) listener(assetId, previews, { replaceMissing });
      return true;
    });
  previewWrites.set(assetId, write);
  try {
    return await write;
  } finally {
    if (previewWrites.get(assetId) === write) previewWrites.delete(assetId);
  }
};

export const getThumbs = async (
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const rows = await getDb().previews.bulkGet(assetIds.map((id) => rowId(id, "thumb")));
  const thumbs = new Map<string, string>();
  for (const row of rows) if (row) thumbs.set(row.assetId, row.dataUrl);
  return thumbs;
};

export const getFilmstrips = async (
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, Filmstrip>> => {
  const rows = await getDb().previews.bulkGet(assetIds.map((id) => rowId(id, "filmstrip")));
  const strips = new Map<string, Filmstrip>();
  for (const row of rows)
    if (row) strips.set(row.assetId, { dataUrl: row.dataUrl, frames: row.frames ?? 0 });
  return strips;
};

const deletePreviews = async (assetIds: readonly string[]): Promise<void> => {
  await getDb().previews.bulkDelete(
    assetIds.flatMap((id) => [rowId(id, "thumb"), rowId(id, "filmstrip")]),
  );
};

// Asset ids with at least one preview; an index scan, so the pictures
// themselves stay on disk.
const listPreviewAssetIds = async (): Promise<ReadonlySet<string>> =>
  new Set((await getDb().previews.orderBy("assetId").uniqueKeys()).map(String));

// Previews written for an asset that is not registered yet (an import in
// flight) must survive a garbage pass that runs meanwhile.
const previewLeases = new Map<string, number>();
export const leasePreview = (assetId: string): (() => void) => {
  previewLeases.set(assetId, (previewLeases.get(assetId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (previewLeases.get(assetId) ?? 1) - 1;
    if (count <= 0) previewLeases.delete(assetId);
    else previewLeases.set(assetId, count);
  };
};

// A project file is the user's escape hatch and should carry its pictures:
// the export re-inlines what this store holds.
export const withInlinePreviews = async (project: Project): Promise<Project> => {
  const ids = project.mediaLibrary.map((a) => a.id);
  if (ids.length === 0) return project;
  const [thumbs, strips] = await Promise.all([getThumbs(ids), getFilmstrips(ids)]);
  if (thumbs.size === 0 && strips.size === 0) return project;
  return {
    ...project,
    mediaLibrary: project.mediaLibrary.map((asset) => {
      const thumb = thumbs.get(asset.id);
      const strip = strips.get(asset.id);
      if (!thumb && !strip) return asset;
      return {
        ...asset,
        ...(!asset.thumbDataUrl && thumb ? { thumbDataUrl: thumb } : {}),
        ...(!asset.filmstripDataUrl && strip
          ? { filmstripDataUrl: strip.dataUrl, filmstripFrames: strip.frames }
          : {}),
      };
    }),
  };
};

// Moves inline previews of the live project into this store and strips
// them from the records (a maintenance write, not an undo step). Runs on
// every library change so imports that still arrive inline (desktop HEIC
// helper, generated map cards, an imported project file) are picked up.
interface PreviewMigrationStore {
  getState: () => { project: Project; dropInlinePreviews: (ids: readonly ID[]) => void };
  subscribe: (listener: (state: { project: Project }) => void) => () => void;
}

export const startInlinePreviewMigration = (store: PreviewMigrationStore): (() => void) => {
  let running = false;
  let queued: readonly MediaAsset[] | null = null;
  const migrate = async (library: readonly MediaAsset[]): Promise<void> => {
    queued = library;
    if (running) return;
    running = true;
    try {
      while (queued) {
        const next = queued;
        queued = null;
        const inline = next.filter(hasInlinePreviews);
        const moved: ID[] = [];
        for (const asset of inline) {
          try {
            const unchanged = () => {
              const before = store.getState().project.mediaLibrary.find((a) => a.id === asset.id);
              return (
                before?.thumbDataUrl === asset.thumbDataUrl &&
                before?.filmstripDataUrl === asset.filmstripDataUrl &&
                before?.filmstripFrames === asset.filmstripFrames
              );
            };
            const written = await putAssetPreviews(asset.id, inlinePreviewsOf(asset), {
              replaceMissing: false,
              shouldWrite: unchanged,
            });
            if (!written) continue;
            // An Undo or project restore can replace the preview while the
            // IndexedDB write is pending. Only strip the exact copy written;
            // the queued pass will persist a newer one before removing it.
            const current = store
              .getState()
              .project.mediaLibrary.find((candidate) => candidate.id === asset.id);
            if (
              current?.thumbDataUrl === asset.thumbDataUrl &&
              current?.filmstripDataUrl === asset.filmstripDataUrl &&
              current?.filmstripFrames === asset.filmstripFrames
            ) {
              moved.push(asset.id);
            }
          } catch {
            // Keep the inline copy: better a fat record than no picture.
          }
        }
        if (moved.length > 0) store.getState().dropInlinePreviews(moved);
      }
    } finally {
      running = false;
    }
  };
  const unsubscribe = store.subscribe((state) => void migrate(state.project.mediaLibrary));
  void migrate(store.getState().project.mediaLibrary);
  return unsubscribe;
};

// ---- garbage ----

const salvageAssetIds = (raw: string, keep: Set<string>): void => {
  for (const match of raw.matchAll(/"id"\s*:\s*"([^"]+)"/g)) {
    const id = match[1];
    if (id) keep.add(id);
  }
};

// Reclaims previews of assets no project (live, saved, or trashed) still
// references. Mirrors collectMediaGarbage: a saved project that cannot be
// read keeps everything its raw JSON might name, and each candidate is
// re-checked against the live project right before deletion.
export const collectPreviewGarbage = async (
  current: () => Project,
  storedProjects?: StoredProjectScan,
): Promise<number> => {
  const keep = new Set<string>();
  const add = (project: Project) => {
    for (const asset of project.mediaLibrary) keep.add(asset.id);
  };
  add(current());
  try {
    for (const id of await trashAssetIds()) keep.add(id);
  } catch {
    return 0;
  }
  for (const result of storedProjects ?? (await scanStoredProjects())) {
    if (result.status === "corrupt") salvageAssetIds(result.raw, keep);
    else if (result.status === "ok") add(result.project);
  }
  try {
    for (const raw of await listSnapshotJson()) salvageAssetIds(raw, keep);
  } catch {
    // A snapshot store failure must not make otherwise reachable previews unsafe.
    return 0;
  }
  const stale: string[] = [];
  for (const id of await listPreviewAssetIds()) {
    if (keep.has(id) || previewLeases.has(id)) continue;
    if (current().mediaLibrary.some((asset) => asset.id === id)) continue;
    stale.push(id);
  }
  if (stale.length > 0) await deletePreviews(stale);
  return stale.length;
};
