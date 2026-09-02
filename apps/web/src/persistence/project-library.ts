// Multi-project library backed by IndexedDB. Each project is keyed by its
// stable id; the active project id is stored alongside so the editor can
// re-open the last project automatically. Yjs continues to hold the live
// canonical state for the *active* project; this store is for the "open
// previous projects" experience.

import Dexie, { type Table } from "dexie";
import type { Project } from "@movie-desk/core";
import { parseStoredProject } from "./project-export";

interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  json: string; // serialized Project to avoid Dexie struct quirks
}

interface MetaRow {
  key: string;
  value: string;
}

class MovieDeskLibraryDB extends Dexie {
  projects!: Table<StoredProject, string>;
  meta!: Table<MetaRow, string>;
  constructor() {
    // Legacy storage key retained so the rename never hides saved projects.
    super("cut_editor.library.v1");
    this.version(1).stores({
      projects: "id, updatedAt, name",
      meta: "key",
    });
  }
}

let db: MovieDeskLibraryDB | null = null;
const getDb = () => {
  if (!db) db = new MovieDeskLibraryDB();
  return db;
};

export const listProjectsLibrary = async (): Promise<readonly StoredProject[]> =>
  getDb().projects.orderBy("updatedAt").reverse().toArray();

export const upsertProject = async (p: Project): Promise<void> => {
  await getDb().projects.put({
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    json: JSON.stringify(p),
  });
};

type StoredProjectLoadResult =
  | { readonly status: "ok"; readonly project: Project }
  | { readonly status: "missing" }
  | { readonly status: "corrupt"; readonly raw: string };

export const loadStoredProject = async (id: string): Promise<StoredProjectLoadResult> => {
  const row = await getDb().projects.get(id);
  if (!row) return { status: "missing" };
  try {
    return { status: "ok", project: parseStoredProject(JSON.parse(row.json)) };
  } catch {
    // Keep the raw JSON so callers (e.g. media GC) can salvage OPFS references
    // and users can still export/recover or delete it from the project menu.
    return { status: "corrupt", raw: row.json };
  }
};

export const deleteStoredProject = async (id: string): Promise<void> => {
  await getDb().projects.delete(id);
};

export const setActiveProjectId = async (id: string): Promise<void> => {
  await getDb().meta.put({ key: "activeProjectId", value: id });
};

export const getActiveProjectId = async (): Promise<string | null> => {
  const row = await getDb().meta.get("activeProjectId");
  return row?.value ?? null;
};
