const PENDING_START_KEY_PREFIX = "cut.editor.new-project-start.pending.v1:";

export interface PendingStartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const localPendingStartStorage = (): PendingStartStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const pendingStartKey = (projectId: string): string => `${PENDING_START_KEY_PREFIX}${projectId}`;

export const isNewProjectStartPending = (
  projectId: string,
  storage = localPendingStartStorage(),
): boolean => {
  try {
    return storage?.getItem(pendingStartKey(projectId)) === "1";
  } catch {
    return false;
  }
};

export const markNewProjectStartPending = (
  projectId: string,
  storage = localPendingStartStorage(),
): void => {
  try {
    storage?.setItem(pendingStartKey(projectId), "1");
  } catch {
    // Guidance persistence is best-effort; the editor must still work when
    // storage is unavailable (for example, in a restricted browser mode).
  }
};

export const clearNewProjectStartPending = (
  projectId: string,
  storage = localPendingStartStorage(),
): void => {
  try {
    storage?.removeItem(pendingStartKey(projectId));
  } catch {
    // See markNewProjectStartPending: local storage cannot block editing.
  }
};
