// Named project snapshots — git-style "save points" stored in IndexedDB,
// independent of the live Yjs doc. Each snapshot is a frozen JSON of the
// project at a moment in time.

import type { Project } from "@movie-desk/core";
import Dexie, { type Table } from "dexie";
import { parseStoredProject } from "./project-export";

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  label: string;
  createdAt: number;
  json: string;
}

class SnapshotDB extends Dexie {
  snapshots!: Table<ProjectSnapshot, string>;
  constructor() {
    // Legacy storage key retained so the rename never hides saved snapshots.
    super("cut_editor.snapshots.v1");
    this.version(1).stores({
      snapshots: "id, projectId, createdAt",
    });
  }
}

let db: SnapshotDB | null = null;
const getDb = () => {
  if (!db) db = new SnapshotDB();
  return db;
};

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const saveSnapshot = async (project: Project, label: string): Promise<void> => {
  await getDb().snapshots.put({
    id: randomId(),
    projectId: project.id,
    label: label || new Date().toLocaleString(),
    createdAt: Date.now(),
    json: JSON.stringify(project),
  });
};

export const listSnapshots = async (projectId: string): Promise<readonly ProjectSnapshot[]> =>
  getDb().snapshots.where("projectId").equals(projectId).reverse().sortBy("createdAt");

export const loadSnapshot = async (id: string): Promise<Project | null> => {
  const row = await getDb().snapshots.get(id);
  if (!row) return null;
  try {
    return parseStoredProject(JSON.parse(row.json));
  } catch {
    return null;
  }
};

export const deleteSnapshot = async (id: string): Promise<void> => {
  await getDb().snapshots.delete(id);
};

export const listSnapshotJson = async (): Promise<readonly string[]> =>
  (await getDb().snapshots.toArray()).map((row) => row.json);
