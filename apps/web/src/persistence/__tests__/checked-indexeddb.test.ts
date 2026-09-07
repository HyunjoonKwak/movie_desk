import "fake-indexeddb/auto";
import { createEmptyProject } from "@movie-desk/core";
import { expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { installCheckedWriter } from "../checked-indexeddb";
import { createProjectCrdt, discardMigrationBackup } from "../project-crdt";
import { legacyCrdt } from "./fixtures/legacy-crdt";

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(`checked:${crypto.randomUUID()}`);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("updates", { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const updates = (db: IDBDatabase): Promise<Uint8Array[]> =>
  new Promise((resolve, reject) => {
    const request = db.transaction("updates").objectStore("updates").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const providerFor = (db: IDBDatabase, doc: Y.Doc) =>
  ({ db, doc, _storeUpdate: () => {} }) as unknown as IndexeddbPersistence;

it("commits v3 before pruning backup and legacy roots, then compacts the physical log", async () => {
  const p = createEmptyProject();
  const doc = legacyCrdt(p);
  doc.getMap("project").set("snapshot", { large: "x".repeat(200_000) });
  const db = await open();
  const original = Y.encodeStateAsUpdate(doc);
  const tx = db.transaction("updates", "readwrite");
  tx.objectStore("updates").add(original);
  const saved = vi.fn();
  const failed = vi.fn();
  let backupAtFirstCommit = false;
  installCheckedWriter(providerFor(db, doc), {
    saved,
    failed,
    cleanup: () => {
      backupAtFirstCommit = doc.getMap("migration-backup-v2").has("update");
      discardMigrationBackup(doc);
    },
  });
  createProjectCrdt(doc).read(p.id, p.timeline);
  expect(saved).not.toHaveBeenCalled();
  expect(doc.getMap("migration-backup-v2").has("update")).toBe(true);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(backupAtFirstCommit).toBe(true);
  expect(failed).not.toHaveBeenCalled();
  const stored = await updates(db);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.byteLength).toBeLessThan(original.byteLength / 2);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, stored[0]!);
  expect(reopened.getMap("migration-backup-v2").size).toBe(0);
  expect(reopened.getMap("project").size).toBe(0);
  expect(reopened.getMap("tracks-v2").size).toBe(0);
  expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.name).toBe(p.name);
  db.close();
  doc.destroy();
  reopened.destroy();
});

it("reports transaction aborts, keeps backup, and retries the complete state", async () => {
  const p = createEmptyProject();
  const doc = legacyCrdt(p);
  const db = await open();
  const provider = providerFor(db, doc);
  const saved = vi.fn();
  const failed = vi.fn();
  const checkpoint = installCheckedWriter(provider, {
    saved,
    failed,
    cleanup: () => discardMigrationBackup(doc),
  });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((...args) => {
    const tx = transaction(...args);
    queueMicrotask(() => tx.abort());
    return tx;
  });
  createProjectCrdt(doc).read(p.id, p.timeline);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(saved).not.toHaveBeenCalled();
  expect(doc.getMap("migration-backup-v2").has("update")).toBe(true);
  expect(await updates(db)).toEqual([]);
  spy.mockRestore();
  checkpoint();
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  const reopened = new Y.Doc();
  for (const update of await updates(db)) Y.applyUpdate(reopened, update);
  expect(createProjectCrdt(reopened).read(p.id, p.timeline)?.name).toBe(p.name);
  expect(reopened.getMap("migration-backup-v2").size).toBe(0);
  db.close();
  doc.destroy();
  reopened.destroy();
});

it("surfaces synchronous quota errors without throwing through document observers", async () => {
  const db = await open();
  const doc = new Y.Doc();
  const failed = vi.fn();
  installCheckedWriter(providerFor(db, doc), { saved: vi.fn(), failed, cleanup: vi.fn() });
  const spy = vi.spyOn(db, "transaction").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  expect(() => doc.getMap("test").set("key", "value")).not.toThrow();
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ name: "QuotaExceededError" }));
  spy.mockRestore();
  db.close();
  doc.destroy();
});

it("keeps another tab's committed updates when cleanup compacts the log", async () => {
  const p = createEmptyProject();
  const doc = legacyCrdt(p);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const db = await open();
  db.transaction("updates", "readwrite").objectStore("updates").add(Y.encodeStateAsUpdate(doc));
  const saved = vi.fn();
  installCheckedWriter(providerFor(db, doc), {
    saved,
    failed: (error) => {
      throw error;
    },
    cleanup: () => {
      remote.getMap("remote-tab").set("keep", "concurrent change");
      db.transaction("updates", "readwrite")
        .objectStore("updates")
        .add(Y.encodeStateAsUpdate(remote));
      discardMigrationBackup(doc);
    },
  });
  createProjectCrdt(doc).read(p.id, p.timeline);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  const reopened = new Y.Doc();
  for (const update of await updates(db)) Y.applyUpdate(reopened, update);
  expect(reopened.getMap("remote-tab").get("keep")).toBe("concurrent change");
  expect(reopened.getMap("migration-backup-v2").size).toBe(0);
  db.close();
  for (const item of [doc, remote, reopened]) item.destroy();
});

it("does not acknowledge a transaction whose add request throws synchronously", async () => {
  const db = await open();
  const doc = new Y.Doc();
  const saved = vi.fn();
  const failed = vi.fn();
  const checkpoint = installCheckedWriter(providerFor(db, doc), {
    saved,
    failed,
    cleanup: vi.fn(),
  });
  const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementationOnce(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  doc.getMap("test").set("key", "survives retry");
  expect(failed).toHaveBeenCalledTimes(1);
  // This read completes after the failed request's otherwise empty transaction.
  expect(await updates(db)).toEqual([]);
  expect(saved).not.toHaveBeenCalled();
  spy.mockRestore();
  checkpoint();
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const reopened = new Y.Doc();
  for (const update of await updates(db)) Y.applyUpdate(reopened, update);
  expect(reopened.getMap("test").get("key")).toBe("survives retry");
  db.close();
  doc.destroy();
  reopened.destroy();
});

it("uses exactly one real provider writer, compacts, hydrates and detaches on destroy", async () => {
  const name = `real-provider:${crypto.randomUUID()}`;
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, doc);
  const saved = vi.fn();
  const failed = vi.fn();
  installCheckedWriter(persistence, { saved, failed, cleanup: vi.fn() });
  await persistence.whenSynced;
  const db = persistence.db!;
  const initial = (await updates(db)).length;
  doc.getMap("test").set("key", "one writer");
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(await updates(db)).toHaveLength(initial + 1);
  // Crossing the provider's native debounce threshold must not schedule its writer.
  for (let i = 1; i < 500; i++) doc.getMap("test").set("counter", i);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(500));
  expect(await updates(db)).toHaveLength(1);
  expect(persistence._storeTimeoutId).toBeNull();
  const transactions = vi.spyOn(db, "transaction");
  await persistence.destroy();
  const count = transactions.mock.calls.length;
  doc.getMap("test").set("after-destroy", true);
  expect(transactions).toHaveBeenCalledTimes(count);
  expect(failed).not.toHaveBeenCalled();
  const reopened = new Y.Doc();
  const next = new IndexeddbPersistence(name, reopened);
  installCheckedWriter(next, { saved: vi.fn(), failed, cleanup: vi.fn() });
  await next.whenSynced;
  expect(reopened.getMap("test").toJSON()).toEqual({ key: "one writer", counter: 499 });
  await next.destroy();
  doc.destroy();
  reopened.destroy();
});

it("backs off compaction after failure while checkpointing the missing edit", async () => {
  const db = await open();
  const doc = new Y.Doc();
  const saved = vi.fn();
  const failed = vi.fn();
  installCheckedWriter(providerFor(db, doc), { saved, failed, cleanup: vi.fn() });
  for (let i = 0; i < 499; i++) doc.getMap("test").set("counter", i);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(499));
  const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  doc.getMap("test").set("failed", "keep");
  expect(failed).toHaveBeenCalledTimes(1);
  doc.getMap("test").set("retry", "saved");
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(500));
  expect(getAll).toHaveBeenCalledTimes(1);
  getAll.mockRestore();
  const reopened = new Y.Doc();
  for (const update of await updates(db)) Y.applyUpdate(reopened, update);
  expect(reopened.getMap("test").get("failed")).toBe("keep");
  expect(reopened.getMap("test").get("retry")).toBe("saved");
  db.close();
  doc.destroy();
  reopened.destroy();
});
