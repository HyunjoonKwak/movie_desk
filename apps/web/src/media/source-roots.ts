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
  const parts = root.displayPath.split("/").filter(Boolean);
  const folder = parts[parts.length - 1] ?? root.displayPath;
  if (root.kind === "local") return folder;
  const volume = parts[0] === "Volumes" ? parts[1] : undefined;
  return volume && volume !== folder ? `${volume} / ${folder}` : folder;
};
