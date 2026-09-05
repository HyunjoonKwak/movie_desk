import { audioVariantKey } from "@/media/audio/audio-variant";
import { musicStoreKeepKeys } from "@/music/file-store";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import type { Project } from "@movie-desk/core";
import { deleteMediaFile, listMediaKeys } from "./opfs";
import { listProjectsLibrary, loadStoredProject } from "./project-library";
import { forEachSnapshotJson } from "./snapshots";
import { trashMediaKeys } from "./trash";

export interface StoredProjectKeep {
  readonly mediaKeys: ReadonlySet<string>;
  readonly assetIds: ReadonlySet<string>;
}

const mediaLeases = new Map<string, number>();

// A producer holds a lease from before the OPFS write until its project
// metadata is committed. Startup GC must not reap files in that atomic gap.
export const leaseMediaKey = (key: string): (() => void) => {
  mediaLeases.set(key, (mediaLeases.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (mediaLeases.get(key) ?? 1) - 1;
    if (remaining <= 0) mediaLeases.delete(key);
    else mediaLeases.set(key, remaining);
  };
};

export const isMediaKeyLeased = (key: string): boolean => mediaLeases.has(key);

// Originals, proxies and the rebuildable audio variant of every asset the
// project references. Exported so the policy is testable without Dexie.
export const referencedMediaKeys = (p: Project, keep: Set<string>): void => {
  for (const a of p.mediaLibrary) {
    if (a.opfsPath) keep.add(a.opfsPath);
    if (a.proxyPath) keep.add(a.proxyPath);
    if (a.kind !== "image") keep.add(audioVariantKey(a));
  }
};

// Best-effort extraction of opfsPath/proxyPath values from raw project JSON we
// couldn't parse, so GC preserves media a corrupt-but-recoverable project still
// references instead of reaping it.
const salvageMediaKeys = (raw: string, keep: Set<string>): void => {
  // Match the full JSON string literal (including escapes) then JSON.parse it,
  // so a filename containing a quote or backslash isn't truncated into a wrong
  // key that could get a still-referenced file reaped.
  const re = /"(?:opfsPath|proxyPath)"\s*:\s*("(?:\\.|[^"\\])*")/g;
  let match = re.exec(raw);
  while (match !== null) {
    const captured = match[1];
    if (captured) {
      try {
        const key = JSON.parse(captured) as string;
        if (key) keep.add(key);
      } catch {
        // Malformed escape — skip this candidate rather than risk a wrong key.
      }
    }
    match = re.exec(raw);
  }
};

const salvageAssetIds = (raw: string, keep: Set<string>): void => {
  for (const match of raw.matchAll(/"id"\s*:\s*"([^"]+)"/g)) {
    const id = match[1];
    if (id) keep.add(id);
  }
};

// Parse one saved row at a time and retain only compact keep sets. A damaged
// row cannot abort the other rows, and snapshots use the same symmetric media
// and preview retention policy without loading all JSON strings at once.
export const scanStoredProjects = async (): Promise<StoredProjectKeep> => {
  const mediaKeys = new Set<string>();
  const assetIds = new Set<string>();
  for (const row of await listProjectsLibrary()) {
    try {
      const result = await loadStoredProject(row.id);
      if (result.status === "ok") {
        referencedMediaKeys(result.project, mediaKeys);
        for (const asset of result.project.mediaLibrary) assetIds.add(asset.id);
      } else if (result.status === "corrupt") {
        salvageMediaKeys(result.raw, mediaKeys);
        salvageAssetIds(result.raw, assetIds);
      }
    } catch {
      // Keep scanning independent rows; a failed read contains no safe keys.
    }
  }
  await forEachSnapshotJson((raw) => {
    salvageMediaKeys(raw, mediaKeys);
    salvageAssetIds(raw, assetIds);
  });
  return { mediaKeys, assetIds };
};

// Reclaim OPFS blobs (originals + proxies) that no project references — the
// current in-memory project plus every project saved in the library. Media
// deletion is metadata-only (see media-bin), so this is what actually frees
// disk. Safe to run at startup: the active project's undo history is empty
// then and every saved project is consulted, so nothing still reachable —
// including anything an in-session Undo could restore — is removed here.
// Returns the number of blobs reclaimed.
// `current` may be a getter: the pass loads every saved project first, and
// an import that lands meanwhile must not lose its file — each candidate is
// re-checked against the live project right before deletion.
export const collectMediaGarbage = async (
  current: Project | (() => Project),
  stored?: StoredProjectKeep,
): Promise<number> => {
  const live = typeof current === "function" ? current : () => current;
  const keep = new Set<string>();
  referencedMediaKeys(live(), keep);
  // Music files in the app-global store stay alive while a library ref
  // points at them — deleting the ref lets the next GC pass reap the file.
  for (const key of musicStoreKeepKeys(useMusicLibraryStore.getState().refs)) keep.add(key);
  // Trashed assets can still be restored, so their files stay until the
  // entry is gone or expired. If the trash cannot be read, nothing can be
  // reaped safely this pass.
  try {
    await trashMediaKeys(keep);
  } catch {
    return 0;
  }
  const saved = stored ?? (await scanStoredProjects());
  for (const key of saved.mediaKeys) keep.add(key);

  let removed = 0;
  for (const key of await listMediaKeys()) {
    if (keep.has(key) || isMediaKeyLeased(key)) continue;
    // Re-read the live project: an import finishing during the library scan
    // above adds assets this pass never saw.
    const now = new Set<string>();
    referencedMediaKeys(live(), now);
    if (now.has(key)) continue;
    await deleteMediaFile(key);
    removed++;
  }
  return removed;
};
