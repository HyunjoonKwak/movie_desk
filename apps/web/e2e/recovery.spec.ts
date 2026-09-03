import { type Page, expect, test } from "@playwright/test";
import {
  PNG,
  MEDIA_INPUT,
  clipCount,
  configurePage,
  mediaCard,
  persistedUpdateCount,
  seedTimeline,
} from "./support";

// Release checklist (B24): the editor never loses work it already accepted.
// Unsaved edits survive an abrupt reload, a damaged project file or saved
// project is refused with a clear message, and the open project stays intact.

const LIBRARY_DB = "cut_editor.library.v1";

// Writes a saved-project row straight into the library, bypassing the app,
// and optionally marks it as the project to reopen on the next load.
const injectStoredProject = async (
  page: Page,
  row: { id: string; name: string; json: string },
  { activate = false } = {},
): Promise<void> => {
  await page.evaluate(
    async ({ dbName, row, activate }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          try {
            if (
              !db.objectStoreNames.contains("projects") ||
              !db.objectStoreNames.contains("meta")
            ) {
              throw new Error(`${dbName} has not been opened by the app yet`);
            }
            const tx = db.transaction(["projects", "meta"], "readwrite");
            tx.objectStore("projects").put({ ...row, updatedAt: Date.now() });
            if (activate) tx.objectStore("meta").put({ key: "activeProjectId", value: row.id });
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          } catch (error) {
            db.close();
            reject(error);
          }
        };
      }),
    { dbName: LIBRARY_DB, row, activate },
  );
};

// The id the app will reopen on the next load, once its own mount-time write
// has landed; null until then.
const activeProjectId = (page: Page): Promise<string | null> =>
  page.evaluate(
    async (dbName) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) {
            db.close();
            resolve(null);
            return;
          }
          const request = db
            .transaction("meta", "readonly")
            .objectStore("meta")
            .get("activeProjectId");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { value?: string } | undefined)?.value ?? null);
          };
        };
      }),
    LIBRARY_DB,
  );

const projectNameInput = (page: Page) => page.locator('header input[type="text"]').first();

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("edits that were never explicitly saved survive an abrupt reload", async ({ page }) => {
  const clips = await seedTimeline(page, 2);
  // Baseline right before the last edit, so the poll below waits for that
  // edit's IndexedDB write and not for the seeding writes that already landed.
  const before = await persistedUpdateCount(page);
  await projectNameInput(page).fill("Recovered trip");
  await projectNameInput(page).press("Enter");
  await expect(page.getByText(/^Saved/)).toBeVisible();
  // The badge flips as soon as the Yjs transaction commits; wait for the
  // IndexedDB write itself before pulling the rug.
  await expect.poll(() => persistedUpdateCount(page)).toBeGreaterThan(before);

  await page.reload();

  await expect(projectNameInput(page)).toHaveValue("Recovered trip");
  await expect.poll(() => clipCount(page)).toBe(clips);
  await expect(mediaCard(page)).toBeVisible();
});

test("a damaged project file is refused and the open project is untouched", async ({ page }) => {
  const clips = await seedTimeline(page, 1);
  await projectNameInput(page).fill("Keep me");
  await projectNameInput(page).press("Enter");

  await page.getByRole("button", { name: "Projects" }).click();
  const dialog = page.getByRole("dialog");
  const jsonInput = dialog.locator('input[type="file"][accept="application/json,.json"]');

  await jsonInput.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ this is not json"),
  });
  // Each failure carries its own reason: the JSON parser's for the first,
  // the schema's for the second, so the two toasts are told apart.
  await expect(page.getByText(/^Import failed: .*JSON/)).toBeVisible();

  await jsonInput.setInputFiles({
    name: "wrong-shape.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "cut_editor-project", version: 1, project: {} })),
  });
  await expect(page.getByText(/^Import failed: [\s\S]*invalid_type/)).toBeVisible();

  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projectNameInput(page)).toHaveValue("Keep me");
  expect(await clipCount(page)).toBe(clips);
});

test("a damaged saved project is reported and cannot replace the open project", async ({
  page,
}) => {
  const clips = await seedTimeline(page, 1);
  await projectNameInput(page).fill("Healthy");
  await projectNameInput(page).press("Enter");
  await injectStoredProject(page, { id: "broken-row", name: "Broken project", json: "{oops" });

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("dialog").getByText("Broken project", { exact: true }).click();
  await expect(
    page.getByText("This saved project is damaged and could not be opened", { exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(projectNameInput(page)).toHaveValue("Healthy");
  expect(await clipCount(page)).toBe(clips);
});

test("a damaged last-opened project falls back to a fresh project on load", async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
  // The app records its own active project on mount; inject only after that
  // write has landed so it cannot overwrite the corrupt pointer.
  await expect.poll(() => activeProjectId(page)).not.toBeNull();
  await injectStoredProject(
    page,
    { id: "broken-active", name: "Broken active", json: "not even json" },
    { activate: true },
  );

  await page.reload();

  await expect(
    page.getByText("The last project is damaged. Opened a new project instead", { exact: true }),
  ).toBeVisible();
  // The editor stays usable: a fresh import still lands in the media bin.
  await page
    .locator(MEDIA_INPUT)
    .setInputFiles({ name: "pix.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page)).toBeVisible();
});
