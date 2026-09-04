import type { ID } from "../utils/id";

// A saved filter specification. Kept loose in core: the renderer owns the
// filter vocabulary and validates a spec when it loads one, so an older
// build can open a project whose smart collection uses a newer filter.
export type MediaFilterSpec = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

export interface ManualCollection {
  readonly id: ID;
  readonly name: string;
  readonly kind: "manual";
  readonly assetIds: readonly ID[]; // may reference trashed assets; ignored until restored
}

// A saved search: free text plus filters, re-evaluated on every open.
export interface SmartCollection {
  readonly id: ID;
  readonly name: string;
  readonly kind: "smart";
  readonly query: string;
  readonly filters: MediaFilterSpec;
}

export type MediaCollection = ManualCollection | SmartCollection;
