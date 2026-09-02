// D1 contract (docs/decisions/2026-09-03-local-media-storage.md): where an
// asset's bytes live and how to tell whether they are still the same bytes.
// The asset id stays a free UUID; identity of location + content is the
// fingerprint below, which cache keys and the catalog both build on.

export interface RootSnapshot {
  readonly volumeUuid?: string;
  readonly volumeRelativePath?: string;
  readonly lastKnownAbsolutePath?: string; // recovery hint, never identity
}

// A user file referenced in place (desktop). `rootId` names a catalog row;
// the snapshot lets a project recover the root when the catalog is gone.
export interface DiskSourceRef {
  readonly kind: "disk";
  readonly version: 1;
  readonly rootId: string;
  readonly rootSnapshot: RootSnapshot;
  readonly relativePath: string; // NFC, relative to the root
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
  readonly inode?: string; // same-volume move candidate only
  readonly quickHash?: string; // size + head/tail chunks
  readonly fullHash?: string; // computed lazily for confirmation
}

// The pre-D1 model: bytes copied into the app's OPFS store. Kept as a legacy
// adapter so every existing project keeps opening.
export interface OpfsSourceRef {
  readonly kind: "opfs";
  readonly version: 1;
  readonly key: string;
  readonly sizeBytes?: number;
}

export type SourceRef = DiskSourceRef | OpfsSourceRef;

// Result of resolving a source (relink order in the D1 decision).
export type MediaSourceState =
  | "online"
  | "moved"
  | "changed"
  | "offline"
  | "permission-denied"
  | "ambiguous";

export type CacheVariant =
  | "thumb-240"
  | "preview-2560"
  | "proxy-1080p"
  | "waveform-v1"
  | "audio-48k"
  | `analysis-${string}`;

// Changes whenever the referenced bytes may have changed; stable across app
// restarts, remounts and catalog rebuilds.
export const sourceFingerprint = (ref: SourceRef): string =>
  ref.kind === "disk"
    ? [
        "disk",
        ref.rootId,
        ref.relativePath,
        ref.sizeBytes,
        ref.modifiedAtMs,
        ...(ref.quickHash ? [ref.quickHash] : []),
      ].join(":")
    : ["opfs", ref.key, ...(ref.sizeBytes !== undefined ? [ref.sizeBytes] : [])].join(":");

// Cache entries are rebuildable, so the key also carries the pipeline version
// that produced them; bump it when colour, orientation or model handling changes.
export const cacheKey = (
  fingerprint: string,
  variant: CacheVariant,
  pipelineVersion: number,
): string => `${variant}/v${pipelineVersion}/${fingerprint}`;

interface LegacyAssetLike {
  readonly opfsPath: string;
  readonly sizeBytes?: number;
  readonly sourceRef?: SourceRef;
}

export const legacySourceRef = (
  asset: Pick<LegacyAssetLike, "opfsPath" | "sizeBytes">,
): OpfsSourceRef => ({
  kind: "opfs",
  version: 1,
  key: asset.opfsPath,
  ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
});

// Every asset has a source: explicit after D1, the OPFS copy before it.
export const sourceRefOf = (asset: LegacyAssetLike): SourceRef =>
  asset.sourceRef ?? legacySourceRef(asset);
