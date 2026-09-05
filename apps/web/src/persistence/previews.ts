import { useProjectStore } from "@/stores/project-store";
import type { ID, MediaAsset, Project } from "@movie-desk/core";
import Dexie, { type Table } from "dexie";
import { listProjectsLibrary, loadStoredProject } from "./project-library";
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

type StoredListener = (assetId: string, previews: AssetPreviews) => void;
const listeners = new Set<StoredListener>();

// The in-memory preview store subscribes here so a freshly imported or
// relinked asset shows its picture without a database round trip.
export const onPreviewsStored = (listener: StoredListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const putAssetPreviews = async (assetId: string, previews: AssetPreviews): Promise<void> => {
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
  if (!previews.thumb) missing.push("thumb");
  if (!previews.filmstrip) missing.push("filmstrip");
  if (rows.length > 0) await getDb().previews.bulkPut(rows);
  if (missing.length > 0) {
    await getDb().previews.bulkDelete(missing.map((kind) => rowId(assetId, kind)));
  }
  for (const listener of listeners) listener(assetId, previews);
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

// ---- inline (legacy) previews on asset records ----

export const hasInlinePreviews = (asset: MediaAsset): boolean =>
  asset.thumbDataUrl !== undefined || asset.filmstripDataUrl !== undefined;

export const inlinePreviewsOf = (asset: MediaAsset): AssetPreviews => ({
  ...(asset.thumbDataUrl ? { thumb: asset.thumbDataUrl } : {}),
  ...(asset.filmstripDataUrl
    ? { filmstrip: { dataUrl: asset.filmstripDataUrl, frames: asset.filmstripFrames ?? 0 } }
    : {}),
});

export const withoutInlinePreviews = (asset: MediaAsset): MediaAsset => {
  if (!hasInlinePreviews(asset) && asset.filmstripFrames === undefined) return asset;
  const { thumbDataUrl: _t, filmstripDataUrl: _f, filmstripFrames: _n, ...rest } = asset;
  return rest as MediaAsset;
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
export const startInlinePreviewMigration = (): (() => void) => {
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
            await putAssetPreviews(asset.id, inlinePreviewsOf(asset));
            // An Undo or project restore can replace the preview while the
            // IndexedDB write is pending. Only strip the exact copy written;
            // the queued pass will persist a newer one before removing it.
            const current = useProjectStore
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
        if (moved.length > 0) useProjectStore.getState().dropInlinePreviews(moved);
      }
    } finally {
      running = false;
    }
  };
  const unsubscribe = useProjectStore.subscribe(
    (state) => state.project.mediaLibrary,
    (library) => void migrate(library),
  );
  void migrate(useProjectStore.getState().project.mediaLibrary);
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
export const collectPreviewGarbage = async (current: () => Project): Promise<number> => {
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
  for (const row of await listProjectsLibrary()) {
    const result = await loadStoredProject(row.id);
    if (result.status === "corrupt") salvageAssetIds(result.raw, keep);
    else if (result.status === "ok") add(result.project);
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
