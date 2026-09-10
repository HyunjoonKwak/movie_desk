import { z } from "zod";
import { readDesktopMediaBridge } from "./source/desktop-media-bridge";

// The folders a library references. This is the one place an absolute path is
// meant to be shown: it is what makes a location recognisable to its owner.
// See docs/decisions/2026-09-08-library-model.md.

const sourceRootSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["local", "removable", "network"]),
  displayPath: z.string().min(1),
  assetCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  // "unknown" means nothing under it has been checked yet, which is not the
  // same as unreachable and must not be reported as a problem.
  state: z.enum(["online", "offline", "unknown"]).default("unknown"),
  displayName: z.string().min(1).optional(),
});

export type SourceRoot = z.infer<typeof sourceRootSchema>;

const listSchema = z.array(sourceRootSchema);

/** Empty in the browser, where originals are copied rather than referenced. */
export const readSourceRoots = async (): Promise<readonly SourceRoot[]> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.sourceRoots) return [];
  const parsed = listSchema.safeParse(await bridge.sourceRoots());
  return parsed.success ? parsed.data : [];
};

/**
 * A name the owner recognises. The last folder is what they actually named;
 * the volume above it distinguishes two folders that share a name.
 */
export const rootDisplayName = (root: SourceRoot): string => {
  if (root.displayName) return root.displayName;
  const parts = root.displayPath.split("/").filter(Boolean);
  const folder = parts[parts.length - 1] ?? root.displayPath;
  if (root.kind === "local") return folder;
  const volume = parts[0] === "Volumes" ? parts[1] : undefined;
  return volume && volume !== folder ? `${volume} / ${folder}` : folder;
};

/** Rename a location, or pass an empty string to fall back to the folder name. */
export const renameSourceRoot = async (rootId: string, displayName: string): Promise<boolean> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.renameRoot) return false;
  return Boolean(await bridge.renameRoot(rootId, displayName));
};

/**
 * Asset ids under one location, so a disconnected location can hand them to
 * the relink flow the media bin already uses.
 */
export const assetIdsForRoot = async (rootId: string): Promise<readonly string[]> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.assetIdsForRoot) return [];
  const parsed = z.array(z.string().min(1)).safeParse(await bridge.assetIdsForRoot(rootId));
  return parsed.success ? parsed.data : [];
};
