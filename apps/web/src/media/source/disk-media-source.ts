import type { DiskSourceRef, MediaAsset, MediaSourceState, SourceRef } from "@movie-desk/core";
import {
  type DesktopAcquireResult,
  type DesktopLeaseGrant,
  type DesktopMediaBridge,
  parseDesktopAcquireResult,
  parseDesktopSourceStateReport,
  readDesktopMediaBridge,
} from "./desktop-media-bridge";
import {
  MediaSourceError,
  type PlaybackLease,
  type RandomAccessMediaSource,
  clampReadRange,
} from "./media-source";

interface DiskMediaSourceDependencies {
  readonly bridge?: DesktopMediaBridge | null;
  readonly fetchFn?: typeof fetch;
}

const error = (state: MediaSourceState, message: string, cause?: unknown): MediaSourceError =>
  new MediaSourceError(state, message, cause === undefined ? undefined : { cause });

const acquireLease = async (
  bridge: DesktopMediaBridge,
  assetId: string,
): Promise<DesktopLeaseGrant> => {
  let result: DesktopAcquireResult;
  try {
    result = parseDesktopAcquireResult(await bridge.acquirePlaybackUrl(assetId));
  } catch (cause) {
    throw error("offline", "desktop media bridge returned an invalid response", cause);
  }
  if (result.kind === "unknown-asset") {
    throw error("offline", "media asset is not available in the desktop catalog");
  }
  if (result.kind === "unavailable") {
    throw error(result.report.state, `media source is ${result.report.state}`);
  }
  return result.lease;
};

const probeSourceState = async (
  bridge: DesktopMediaBridge,
  assetId: string,
): Promise<MediaSourceState | null> => {
  try {
    return parseDesktopSourceStateReport(await bridge.sourceState(assetId)).state;
  } catch {
    return null;
  }
};

const responseState = async (
  response: Response,
  bridge: DesktopMediaBridge,
  assetId: string,
): Promise<MediaSourceState> => {
  const header = response.headers.get("X-Movie-Desk-Source-State");
  if (
    header === "online" ||
    header === "moved" ||
    header === "changed" ||
    header === "offline" ||
    header === "permission-denied" ||
    header === "ambiguous"
  ) {
    return header;
  }
  const probed = await probeSourceState(bridge, assetId);
  if (probed && probed !== "online" && probed !== "moved") return probed;
  if (response.status === 403) return "permission-denied";
  if (response.status === 409 || response.status === 416) return "changed";
  return "offline";
};

const releaseReadLease = async (
  bridge: DesktopMediaBridge,
  lease: DesktopLeaseGrant,
): Promise<void> => {
  try {
    await bridge.releasePlaybackUrl(lease.leaseId);
  } catch {
    // Releasing is best effort: a failed cleanup must not replace the read's
    // result or its actionable source-state error.
  }
};

const releasePlaybackLease = (bridge: DesktopMediaBridge, leaseId: string): void => {
  try {
    void bridge.releasePlaybackUrl(leaseId).catch(() => {});
  } catch {
    // PlaybackLease.release() is intentionally idempotent and non-throwing.
  }
};

export const createDiskMediaSource = async (
  asset: MediaAsset,
  ref: DiskSourceRef,
  dependencies: DiskMediaSourceDependencies = {},
): Promise<RandomAccessMediaSource> => {
  const bridge = "bridge" in dependencies ? dependencies.bridge : readDesktopMediaBridge();
  const fetchFn = dependencies.fetchFn ?? globalThis.fetch;
  if (!bridge) {
    throw error("offline", "referenced files require the Movie Desk desktop app");
  }
  if (typeof fetchFn !== "function") {
    throw error("offline", "this runtime cannot read referenced media");
  }

  const read = async (start: number, length: number): Promise<ArrayBuffer> => {
    const range = clampReadRange(start, length, ref.sizeBytes);
    if (range.length === 0) return new ArrayBuffer(0);

    let lease: DesktopLeaseGrant | null = null;
    try {
      lease = await acquireLease(bridge, asset.id);
      const end = range.start + range.length - 1;
      let response: Response;
      try {
        response = await fetchFn(lease.url, {
          headers: { Range: `bytes=${range.start}-${end}` },
        });
      } catch (cause) {
        const state = await probeSourceState(bridge, asset.id);
        throw error(
          state && state !== "online" && state !== "moved" ? state : "offline",
          "media range request failed",
          cause,
        );
      }

      if (response.status !== 206) {
        throw error(
          await responseState(response, bridge, asset.id),
          `media range request returned HTTP ${response.status}`,
        );
      }
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch (cause) {
        const state = await probeSourceState(bridge, asset.id);
        throw error(
          state && state !== "online" && state !== "moved" ? state : "offline",
          "media range response could not be read",
          cause,
        );
      }
      if (bytes.byteLength !== range.length) {
        throw error("changed", "media range response length does not match the source");
      }
      return bytes;
    } finally {
      if (lease) await releaseReadLease(bridge, lease);
    }
  };

  return {
    assetId: asset.id,
    sizeBytes: ref.sizeBytes,
    mime: asset.mime,
    read,
    acquirePlaybackUrl: async (): Promise<PlaybackLease> => {
      const lease = await acquireLease(bridge, asset.id);
      let released = false;
      return {
        url: lease.url,
        release: () => {
          if (released) return;
          released = true;
          releasePlaybackLease(bridge, lease.leaseId);
        },
      };
    },
  };
};

export const createDiskMediaSourceAdapter =
  (dependencies: DiskMediaSourceDependencies = {}) =>
  async (asset: MediaAsset, ref: SourceRef): Promise<RandomAccessMediaSource> => {
    if (ref.kind !== "disk") {
      throw new TypeError(`disk media adapter received a ${ref.kind} source`);
    }
    return createDiskMediaSource(asset, ref, dependencies);
  };
