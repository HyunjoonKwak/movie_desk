import type { MediaAsset, SourceRef } from "@movie-desk/core";
import { sourceRefOf } from "@movie-desk/core";
import { MediaSourceError, type RandomAccessMediaSource } from "./media-source";
import { createOpfsMediaSource } from "./opfs-media-source";

// Picks the adapter for an asset's source kind. The desktop shell registers
// its "disk" adapter (media:// range protocol) at startup; the web build only
// has the OPFS one, so a disk-referenced asset resolves as offline there
// instead of crashing.
type MediaSourceAdapter = (asset: MediaAsset, ref: SourceRef) => Promise<RandomAccessMediaSource>;

const adapters = new Map<SourceRef["kind"], MediaSourceAdapter>();

const registerDefaults = (): void => {
  adapters.set("opfs", (asset) => createOpfsMediaSource(asset));
};
registerDefaults();

export const registerMediaSourceAdapter = (
  kind: SourceRef["kind"],
  adapter: MediaSourceAdapter,
): void => {
  adapters.set(kind, adapter);
};

export const resetMediaSourceAdaptersForTests = (): void => {
  adapters.clear();
  registerDefaults();
};

export const resolveMediaSource = async (asset: MediaAsset): Promise<RandomAccessMediaSource> => {
  const ref = sourceRefOf(asset);
  const adapter = adapters.get(ref.kind);
  if (!adapter) {
    throw new MediaSourceError(
      "offline",
      `no media source adapter for "${ref.kind}" in this build`,
    );
  }
  return adapter(asset, ref);
};
