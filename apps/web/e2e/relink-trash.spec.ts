import { type Page, expect, test } from "@playwright/test";
import { PNG, clipCount, configurePage, mediaCard, opfsKeys, seedTimeline } from "./support";

// Library safety (A4): a missing original can be relinked from a file, a
// look-alike is not swapped in silently, and removed media waits in the
// trash where it can be restored.

const removeOpfsKey = async (page: Page, suffix: string): Promise<void> => {
  const key = (await opfsKeys(page)).find((k) => k.endsWith(suffix));
  expect(key, `an OPFS key ending in ${suffix}`).toBeTruthy();
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  }, key as string);
};

const flagMissing = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mediaCard(page).locator("[data-missing]")).toBeVisible({ timeout: 15_000 });
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("a missing original is relinked from a file of the same size", async ({ page }) => {
  await seedTimeline(page, 1);
  await removeOpfsKey(page, "__pix.png");
  await flagMissing(page);

  await mediaCard(page).hover();
  await page.locator("[data-relink]").click();
  await page
    .locator("[data-relink-input]")
    .setInputFiles({ name: "pix-copy.png", mimeType: "image/png", buffer: PNG });

  await expect(page.getByText('Relinked "pix.png"', { exact: true })).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("[data-preview-missing]")).toHaveCount(0);
  expect((await opfsKeys(page)).some((key) => key.endsWith("__pix.png"))).toBe(true);
});

test("a file of a different size is only relinked after the user insists", async ({ page }) => {
  await seedTimeline(page, 1);
  await removeOpfsKey(page, "__pix.png");
  await flagMissing(page);

  await mediaCard(page).hover();
  await page.locator("[data-relink]").click();
  await page.locator("[data-relink-input]").setInputFiles({
    name: "bigger.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG, Buffer.alloc(512)]),
  });

  await expect(page.getByText(/It may not be the same media/)).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toBeVisible();
  await page.getByRole("button", { name: "Relink anyway" }).click();
  await expect(page.getByText('Relinked "pix.png"', { exact: true })).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toHaveCount(0, { timeout: 15_000 });
});

test("removed media waits in the trash and can be restored", async ({ page }) => {
  const clips = await seedTimeline(page, 1);
  expect(clips).toBeGreaterThan(0);

  await mediaCard(page).hover();
  await page.getByTitle("Delete media").click();
  await expect(page.getByText('Moved "pix.png" to the trash', { exact: true })).toBeVisible();
  await expect(mediaCard(page)).toHaveCount(0);
  expect(await clipCount(page)).toBe(0);

  await page.getByRole("button", { name: /^Trash \(1\)$/ }).click();
  const dialog = page.locator("[data-trash-dialog]");
  await expect(dialog.getByText("pix.png", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText('Restored "pix.png"', { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mediaCard(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Trash \(0\)$/ })).toBeVisible();
});
