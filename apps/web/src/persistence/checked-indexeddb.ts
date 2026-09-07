import type { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

// y-indexeddb's update listener does not observe add/transaction failures, and
// storeState resolves before its write commits. Keep its hydration protocol but
// replace the update writer with transaction-completion acknowledgements.
export const installCheckedWriter = (
  persistence: IndexeddbPersistence,
  callbacks: { saved: () => void; failed: (error: unknown) => void; cleanup: () => void },
): (() => void) => {
  const { doc } = persistence;
  doc.off("update", persistence._storeUpdate);
  let retryCheckpoint = false;
  let compactNext = false;
  let writes = 0;
  persistence._storeUpdate = (update, origin) => {
    if (!persistence.db || origin === persistence) return;
    const compact = compactNext || ++writes >= 500;
    compactNext = false;
    const fullCheckpoint = retryCheckpoint;
    const bytes = fullCheckpoint ? Y.encodeStateAsUpdate(doc) : update;
    let writeFailed = false;
    const fail = (error: unknown) => {
      if (writeFailed) return;
      writeFailed = true;
      retryCheckpoint = true;
      // Back off for another full interval after failed compaction. Retrying
      // durability needs a checkpoint, not an expensive merge on every edit.
      writes = 0;
      compactNext = false;
      callbacks.failed(error);
    };
    try {
      const transaction = persistence.db.transaction("updates", "readwrite");
      const store = transaction.objectStore("updates");
      transaction.onabort = () => fail(transaction.error ?? new Error("Document save aborted"));
      transaction.oncomplete = () => {
        if (writeFailed) return;
        // A queued delta may commit after an earlier write failed. It cannot
        // acknowledge the missing delta; checkpoint the complete state first.
        if (retryCheckpoint && !fullCheckpoint) {
          persistence._storeUpdate(Y.encodeStateAsUpdate(doc), null);
          return;
        }
        retryCheckpoint = false;
        if (compact) {
          writes = 0;
          persistence._dbref = 0;
          persistence._dbsize = 1;
        }
        callbacks.saved();
        if (
          doc.getMap("project-meta").get("schemaVersion") === 3 &&
          (doc.getMap("migration-backup-v2").size ||
            doc.getMap("tracks-v2").size ||
            doc.getMap("clips").size ||
            doc.getMap("project").size ||
            doc.getMap("structure").size)
        ) {
          compactNext = true;
          callbacks.cleanup();
        }
      };
      if (compact) {
        // Merge *inside* the write transaction before replacing the log, so
        // another tab's committed updates cannot be lost during compaction.
        const request = store.getAll();
        request.onsuccess = () => {
          const merged = new Y.Doc();
          try {
            for (const stored of request.result) Y.applyUpdate(merged, stored);
            Y.applyUpdate(merged, bytes);
            const snapshot = Y.encodeStateAsUpdate(merged);
            store.clear();
            store.add(snapshot);
          } catch {
            transaction.abort();
          } finally {
            merged.destroy();
          }
        };
      } else {
        store.add(bytes);
      }
    } catch (error) {
      fail(error);
    }
  };
  doc.on("update", persistence._storeUpdate);
  return () => persistence._storeUpdate(Y.encodeStateAsUpdate(doc), null);
};
