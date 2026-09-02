import type { MediaSourceState } from "@movie-desk/core";
import { z } from "zod";

// Renderer-side view of the context-isolated Electron preload bridge. IPC
// responses are untrusted runtime values even though the TypeScript caller is
// typed, so parse them before handing a URL or source state to an adapter.
export interface DesktopMediaBridge {
  acquirePlaybackUrl(assetId: string): Promise<unknown>;
  releasePlaybackUrl(leaseId: string): Promise<unknown>;
  sourceState(assetId: string): Promise<unknown>;
}

const SOURCE_STATE_FLAGS: Record<MediaSourceState, true> = {
  online: true,
  moved: true,
  changed: true,
  offline: true,
  "permission-denied": true,
  ambiguous: true,
};

const SOURCE_STATES = Object.keys(SOURCE_STATE_FLAGS) as [MediaSourceState, ...MediaSourceState[]];
const sourceStateSchema = z.enum(SOURCE_STATES);

const sourceStateReportSchema = z.object({
  state: sourceStateSchema,
  reason: z.string().optional(),
  candidateCount: z.number().int().nonnegative().optional(),
});

const leaseGrantSchema = z.object({
  leaseId: z.string().min(1),
  url: z.string().regex(/^media:\/\/asset\//),
  state: z.enum(["online", "moved"]),
});

export type DesktopSourceStateReport = z.infer<typeof sourceStateReportSchema>;
export type DesktopLeaseGrant = z.infer<typeof leaseGrantSchema>;
export type DesktopAcquireResult =
  | { readonly kind: "unknown-asset" }
  | { readonly kind: "lease"; readonly lease: DesktopLeaseGrant }
  | { readonly kind: "unavailable"; readonly report: DesktopSourceStateReport };

export const parseDesktopSourceStateReport = (value: unknown): DesktopSourceStateReport =>
  sourceStateReportSchema.parse(value);

export const parseDesktopAcquireResult = (value: unknown): DesktopAcquireResult => {
  if (value === null) return { kind: "unknown-asset" };
  const lease = leaseGrantSchema.safeParse(value);
  if (lease.success) return { kind: "lease", lease: lease.data };
  const unavailable = sourceStateReportSchema.safeParse(value);
  if (unavailable.success) return { kind: "unavailable", report: unavailable.data };
  throw new TypeError("desktop media bridge returned an invalid acquire result");
};

type BridgeHost = { cutDesktop?: { media?: unknown } };

const BRIDGE_METHODS: ReadonlyArray<keyof DesktopMediaBridge> = [
  "acquirePlaybackUrl",
  "releasePlaybackUrl",
  "sourceState",
];

// Null during SSR, in the browser/PWA, and with an older preload. In all three
// cases the resolver stays OPFS-only and reports disk sources as offline.
export const readDesktopMediaBridge = (): DesktopMediaBridge | null => {
  if (typeof window === "undefined") return null;
  const media = (window as unknown as BridgeHost).cutDesktop?.media;
  if (typeof media !== "object" || media === null) return null;
  const candidate = media as Partial<Record<keyof DesktopMediaBridge, unknown>>;
  return BRIDGE_METHODS.every((method) => typeof candidate[method] === "function")
    ? (media as DesktopMediaBridge)
    : null;
};
