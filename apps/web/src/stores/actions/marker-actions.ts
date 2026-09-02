import { addMarker, removeMarker, updateMarker } from "@movie-desk/core";
import type { ID, Marker, Ms } from "@movie-desk/core";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

export interface MarkerActions {
  addMarkerAt: (atMs: Ms, label?: string) => void;
  removeMarkerById: (markerId: ID) => void;
  updateMarkerById: (markerId: ID, patch: Partial<Omit<Marker, "id">>) => void;
}

export const createMarkerActions = <S extends ProjectMutating>(set: SetFn<S>): MarkerActions => ({
  addMarkerAt: (atMs, label = "") =>
    runWith(set, "Add marker", (p) => addMarker(p, { at: atMs, label, color: "#fbbf24" })),
  removeMarkerById: (markerId) =>
    runWith(set, "Remove marker", (p) => removeMarker(p, markerId)),
  updateMarkerById: (markerId, patch) =>
    runWith(set, "Update marker", (p) => updateMarker(p, markerId, patch)),
});
