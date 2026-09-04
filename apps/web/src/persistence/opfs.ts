// Minimal OPFS file store. Falls back to in-memory blob URLs if OPFS is
// unavailable (Firefox private, older Safari, etc.).

const inMemory = new Map<string, Blob>();
const objectUrls = new Map<string, { url: string; references: number }>();

const supportsOpfs = () =>
  typeof navigator !== "undefined" && "storage" in navigator && "getDirectory" in navigator.storage;

const getRoot = async (): Promise<FileSystemDirectoryHandle> => {
  return await navigator.storage.getDirectory();
};

const revokeMediaUrl = (key: string): void => {
  const entry = objectUrls.get(key);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  objectUrls.delete(key);
};

export interface MediaUrlLease {
  readonly url: string;
  release(): void;
}

export interface MediaFileWriter {
  write: (offset: number, data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}

// Opens a media file for incremental, positional writes, so a large asset
// never has to be assembled in memory first.
export const createMediaFileWriter = async (
  key: string,
  mimeType: string,
): Promise<MediaFileWriter> => {
  revokeMediaUrl(key);

  if (!supportsOpfs()) {
    const chunks: ArrayBuffer[] = [];
    let nextOffset = 0;
    let settled = false;
    return {
      write: async (offset, data) => {
        if (settled) throw new Error("Media writer is already settled");
        if (offset !== nextOffset) throw new Error("Media chunks must be written sequentially");
        const copy = Uint8Array.from(data);
        chunks.push(copy.buffer);
        nextOffset += copy.byteLength;
      },
      close: async () => {
        if (settled) return;
        settled = true;
        inMemory.set(key, new Blob(chunks, { type: mimeType }));
      },
      abort: async () => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        inMemory.delete(key);
      },
    };
  }

  const root = await getRoot();
  const handle = await root.getFileHandle(key, { create: true });
  const writable = await handle.createWritable();
  let settled = false;
  return {
    write: async (offset, data) => {
      if (settled) throw new Error("Media writer is already settled");
      await writable.write({ type: "write", position: offset, data: Uint8Array.from(data) });
    },
    close: async () => {
      if (settled) return;
      settled = true;
      await writable.close();
    },
    abort: async () => {
      if (settled) return;
      settled = true;
      try {
        await writable.abort();
      } finally {
        try {
          await root.removeEntry(key);
        } catch {
          // The browser may already have discarded the incomplete entry.
        }
      }
    },
  };
};

export const writeMediaFile = async (key: string, file: File): Promise<string> => {
  revokeMediaUrl(key);
  if (!supportsOpfs()) {
    inMemory.set(key, file);
    return key;
  }
  const root = await getRoot();
  const handle = await root.getFileHandle(key, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
    await writable.close();
    return key;
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Preserve the original write failure; cleanup continues below.
    }
    try {
      await root.removeEntry(key);
    } catch {
      // The browser may already have discarded the incomplete entry.
    }
    throw error;
  }
};

// Replaces the bytes behind `key` without ever leaving it half-written: the
// new file is written under a temporary key first, and only once that
// succeeded does it take the key's place (a rename where the browser
// supports it, a copy otherwise). A failure leaves the previous file intact
// and the temporary copy for startup GC to reap.
export const replaceMediaFile = async (key: string, file: File): Promise<string> => {
  revokeMediaUrl(key);
  if (!supportsOpfs()) {
    inMemory.set(key, file);
    return key;
  }
  const tempKey = `${key}.replace-tmp`;
  await writeMediaFile(tempKey, file);
  const root = await getRoot();
  const temp = (await root.getFileHandle(tempKey)) as FileSystemFileHandle & {
    move?: (name: string) => Promise<void>;
  };
  if (typeof temp.move === "function") {
    try {
      await root.removeEntry(key);
    } catch {
      // Nothing to replace.
    }
    await temp.move(key);
  } else {
    await writeMediaFile(key, await temp.getFile());
    await root.removeEntry(tempKey);
  }
  return key;
};

export const readMediaFile = async (key: string): Promise<Blob | null> => {
  if (!supportsOpfs()) return inMemory.get(key) ?? null;
  try {
    const root = await getRoot();
    const handle = await root.getFileHandle(key);
    return await handle.getFile();
  } catch {
    return null;
  }
};

export const acquireMediaUrl = async (key: string): Promise<MediaUrlLease | null> => {
  let entry = objectUrls.get(key);
  if (!entry) {
    const blob = await readMediaFile(key);
    if (!blob) return null;
    entry = { url: URL.createObjectURL(blob), references: 0 };
    objectUrls.set(key, entry);
  }
  entry.references++;
  let released = false;
  return {
    url: entry.url,
    release: () => {
      if (released) return;
      released = true;
      const current = objectUrls.get(key);
      if (!current || current.url !== entry.url) return;
      current.references--;
      if (current.references <= 0) revokeMediaUrl(key);
    },
  };
};

export const deleteMediaFile = async (key: string): Promise<void> => {
  revokeMediaUrl(key);
  inMemory.delete(key);
  if (!supportsOpfs()) return;
  try {
    const root = await getRoot();
    await root.removeEntry(key);
  } catch {
    // ignore
  }
};

// Every key currently held in the OPFS store (or the in-memory fallback).
// Used by media GC to find blobs no project references anymore.
export const listMediaKeys = async (): Promise<readonly string[]> => {
  if (!supportsOpfs()) return [...inMemory.keys()];
  try {
    const root = await getRoot();
    const keys: string[] = [];
    for await (const key of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
};

// Browser-quota snapshot. Returns `null` if the StorageManager API isn't
// available (e.g. older Safari).
export const getStorageUsage = async (): Promise<{
  usageBytes: number;
  quotaBytes: number;
} | null> => {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    usageBytes: est.usage ?? 0,
    quotaBytes: est.quota ?? 0,
  };
};
