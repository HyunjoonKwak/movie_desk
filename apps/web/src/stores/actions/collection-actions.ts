import type { ID, MediaCollection, MediaFilterSpec, Project } from "@movie-desk/core";
import { newId } from "@movie-desk/core";
import { type ProjectMutating, type SetFn, runWith } from "../store-helpers";

// Collections live on the project. A manual collection is a membership
// list; a smart collection is a saved search. Membership keeps ids of
// trashed assets so a restore brings them back; readers ignore unknown ids.
export interface CollectionActions {
  createCollection: (name: string, assetIds?: readonly ID[]) => ID;
  createSmartCollection: (name: string, query: string, filters: MediaFilterSpec) => ID;
  renameCollection: (collectionId: ID, name: string) => void;
  deleteCollection: (collectionId: ID) => void;
  addToCollection: (collectionId: ID, assetIds: readonly ID[]) => void;
  removeFromCollection: (collectionId: ID, assetIds: readonly ID[]) => void;
}

const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, 80);

const withCollections = (p: Project, collections: readonly MediaCollection[]): Project =>
  collections.length === 0 ? dropCollections(p) : { ...p, collections };

const dropCollections = (p: Project): Project => {
  if (!("collections" in p)) return p;
  const { collections: _dropped, ...rest } = p;
  return rest as Project;
};

const mapCollection = (
  set: SetFn<ProjectMutating>,
  label: string,
  collectionId: ID,
  update: (collection: MediaCollection) => MediaCollection,
): void =>
  runWith(set, label, (p) => {
    const current = p.collections ?? [];
    let changed = false;
    const collections = current.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const next = update(collection);
      if (next !== collection) changed = true;
      return next;
    });
    return changed ? { ...p, collections } : p;
  });

export const createCollectionActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): CollectionActions => {
  const setter = set as unknown as SetFn<ProjectMutating>;
  return {
    createCollection: (name, assetIds = []) => {
      const id = newId();
      runWith(setter, "Create collection", (p) => ({
        ...p,
        collections: [
          ...(p.collections ?? []),
          { id, name: cleanName(name), kind: "manual", assetIds: [...new Set(assetIds)] },
        ],
      }));
      return id;
    },

    createSmartCollection: (name, query, filters) => {
      const id = newId();
      runWith(setter, "Save smart collection", (p) => ({
        ...p,
        collections: [
          ...(p.collections ?? []),
          { id, name: cleanName(name), kind: "smart", query, filters },
        ],
      }));
      return id;
    },

    renameCollection: (collectionId, name) =>
      mapCollection(setter, "Rename collection", collectionId, (collection) => {
        const next = cleanName(name);
        return next === "" || next === collection.name ? collection : { ...collection, name: next };
      }),

    deleteCollection: (collectionId) =>
      runWith(setter, "Delete collection", (p) => {
        const current = p.collections ?? [];
        const collections = current.filter((collection) => collection.id !== collectionId);
        return collections.length === current.length ? p : withCollections(p, collections);
      }),

    addToCollection: (collectionId, assetIds) =>
      mapCollection(setter, "Add to collection", collectionId, (collection) => {
        if (collection.kind !== "manual") return collection;
        const missing = assetIds.filter((id) => !collection.assetIds.includes(id));
        if (missing.length === 0) return collection;
        return { ...collection, assetIds: [...collection.assetIds, ...new Set(missing)] };
      }),

    removeFromCollection: (collectionId, assetIds) =>
      mapCollection(setter, "Remove from collection", collectionId, (collection) => {
        if (collection.kind !== "manual") return collection;
        const drop = new Set(assetIds);
        const assetIds2 = collection.assetIds.filter((id) => !drop.has(id));
        return assetIds2.length === collection.assetIds.length
          ? collection
          : { ...collection, assetIds: assetIds2 };
      }),
  };
};
