import { type Page, expect } from "@playwright/test";

// Shared seeding helpers for the editor specs. Everything here talks to the
// UI the way a user would; only the IndexedDB probes reach behind it.

// A 1×1 PNG: the cheapest asset that still renders through the compositor.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const MEDIA_INPUT = 'input[type="file"][accept="video/*,audio/*,image/*"]';

// English UI and no first-run welcome toast, so text assertions are stable.
export const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
};

// The media-bin card for a file, as opposed to the timeline clips that carry
// the same name.
export const mediaCard = (page: Page, name = "pix.png") =>
  page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) }).first();

export const clipCount = (page: Page): Promise<number> => page.locator("[data-clip]").count();

// Imports one still image and appends it `presses` times. Returns how many
// clips landed — the import itself may place the first one.
export const seedTimeline = async (page: Page, presses: number): Promise<number> => {
  await page.goto("/editor");
  await page
    .locator(MEDIA_INPUT)
    .setInputFiles({ name: "pix.png", mimeType: "image/png", buffer: PNG });
  await mediaCard(page).click();
  for (let i = 0; i < presses; i++) await page.keyboard.press("e");
  await expect.poll(() => clipCount(page)).toBeGreaterThanOrEqual(presses);
  await page.waitForTimeout(300);
  return clipCount(page);
};

// Every key in the origin's OPFS root (the media store).
export const opfsKeys = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const keys: string[] = [];
    for await (const key of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      keys.push(key);
    }
    return keys;
  });

// Number of Yjs updates y-indexeddb has committed for every live project
// document. Grows on each persisted edit, so a spec can wait for durability
// instead of trusting the "Saved" badge, which flips before the write lands.
export const persistedUpdateCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const names = databases
      .map((db) => db.name ?? "")
      .filter((name) => name.startsWith("cut-editor:project:"));
    let total = 0;
    for (const name of names) {
      total += await new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("updates")) {
            db.close();
            resolve(0);
            return;
          }
          const request = db.transaction("updates", "readonly").objectStore("updates").count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      });
    }
    return total;
  });
