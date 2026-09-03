import type { MediaAsset, MediaSourceState } from "@movie-desk/core";
import { MediaSourceError, type RandomAccessMediaSource } from "./media-source";
import { resolveMediaSource } from "./resolve-media-source";

// Whether an asset's bytes can still be reached. "ok" means the source
// opened and its first byte was read; anything else is the source state the
// adapter reported (a disconnected drive is "offline", a denied bookmark is
// "permission-denied", a file that changed underneath is "changed"), or
// "unknown" for a failure that was not a source problem.
export type SourceHealth = "ok" | Exclude<MediaSourceState, "online"> | "unknown";

export const isSourceMissing = (health: SourceHealth | undefined): boolean =>
  health !== undefined && health !== "ok";

// Resolving alone proves little: the OPFS adapter hands back a lazy File and
// the desktop adapter only checks that its bridge exists. Reading the first
// byte makes both actually touch the bytes (a media:// range request on the
// desktop), and an empty copy is the partial-write case, not a source.
export const probeAssetSource = async (
  asset: MediaAsset,
  resolve: (asset: MediaAsset) => Promise<RandomAccessMediaSource> = resolveMediaSource,
): Promise<SourceHealth> => {
  try {
    const source = await resolve(asset);
    if (source.sizeBytes === 0) return "changed";
    await source.read(0, 1);
    return "ok";
  } catch (error) {
    return error instanceof MediaSourceError && error.state !== "online" ? error.state : "unknown";
  }
};
