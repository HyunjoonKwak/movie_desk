// Named project snapshots — git-style "save points" stored in IndexedDB,
// independent of the live Yjs doc. Each snapshot is a frozen JSON of the
// project at a moment in time.

import type { Project } from "@movie-desk/core";
import Dexie, { type Table } from "dexie";
import { parseStoredProject, prepareStoredProject } from "./project-io";

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
    json: JSON.stringify(prepareStoredProject(project)),
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

export const forEachSnapshotJson = async (visit: (json: string) => void): Promise<void> => {
  await getDb().snapshots.each((row) => visit(row.json));
};

export const DEFAULT_SNAPSHOT_LIMIT = 20;

// A proposal only: saving never silently removes a user's save point.
export const snapshotCleanupCandidates = (
  rows: readonly ProjectSnapshot[],
  limit = DEFAULT_SNAPSHOT_LIMIT,
): readonly ProjectSnapshot[] => {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid snapshot limit");
  return [...rows]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(limit)
    .reverse();
};

// Only the exact ids the user reviewed, scoped to the project they reviewed.
export const cleanupSnapshots = async (
  projectId: string,
  confirmedIds: readonly string[],
): Promise<void> => {
  await getDb().transaction("rw", getDb().snapshots, async () => {
    const rows = await getDb().snapshots.bulkGet([...confirmedIds]);
    await getDb().snapshots.bulkDelete(
      rows.flatMap((row) => (row?.projectId === projectId ? [row.id] : [])),
    );
  });
};
