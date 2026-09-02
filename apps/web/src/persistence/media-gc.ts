import { audioVariantKey } from "@/media/audio/audio-variant";
import { musicStoreKeepKeys } from "@/music/file-store";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import type { Project } from "@movie-desk/core";
import { deleteMediaFile, listMediaKeys } from "./opfs";
import { listProjectsLibrary, loadStoredProject } from "./project-library";

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

// Reclaim OPFS blobs (originals + proxies) that no project references — the
// current in-memory project plus every project saved in the library. Media
// deletion is metadata-only (see media-bin), so this is what actually frees
// disk. Safe to run at startup: the active project's undo history is empty
// then and every saved project is consulted, so nothing still reachable —
// including anything an in-session Undo could restore — is removed here.
// Returns the number of blobs reclaimed.
export const collectMediaGarbage = async (current: Project): Promise<number> => {
  const keep = new Set<string>();
  referencedMediaKeys(current, keep);
  // Music files in the app-global store stay alive while a library ref
  // points at them — deleting the ref lets the next GC pass reap the file.
  for (const key of musicStoreKeepKeys(useMusicLibraryStore.getState().refs)) keep.add(key);
  for (const row of await listProjectsLibrary()) {
    const result = await loadStoredProject(row.id);
    // A damaged row can't be parsed, but salvage any OPFS-key-shaped strings
    // from its raw JSON so a recoverable project's media is never reaped — and
    // keep scanning instead of aborting the whole pass forever (one corrupt row
    // used to disable GC permanently).
    if (result.status === "corrupt") {
      salvageMediaKeys(result.raw, keep);
      continue;
    }
    if (result.status === "ok") referencedMediaKeys(result.project, keep);
  }

  let removed = 0;
  for (const key of await listMediaKeys()) {
    if (!keep.has(key) && !isMediaKeyLeased(key)) {
      await deleteMediaFile(key);
      removed++;
    }
  }
  return removed;
};
