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
          const tx = db.transaction(["projects", "meta"], "readwrite");
          tx.objectStore("projects").put({ ...row, updatedAt: Date.now() });
          if (activate) tx.objectStore("meta").put({ key: "activeProjectId", value: row.id });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { dbName: LIBRARY_DB, row, activate },
  );
};

const projectNameInput = (page: Page) => page.locator('header input[type="text"]').first();

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("edits that were never explicitly saved survive an abrupt reload", async ({ page }) => {
  const before = await persistedUpdateCount(page).catch(() => 0);
  const clips = await seedTimeline(page, 2);
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
  await expect(page.getByText(/^Import failed/).first()).toBeVisible();

  await jsonInput.setInputFiles({
    name: "wrong-shape.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "cut_editor-project", version: 1, project: {} })),
  });
  await expect(page.getByText(/^Import failed/)).toHaveCount(2);

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
