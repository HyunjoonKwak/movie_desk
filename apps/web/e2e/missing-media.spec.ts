import { type Page, expect, test } from "@playwright/test";
import { configurePage, mediaCard, opfsKeys, seedTimeline } from "./support";

// Release checklist (B24): when an asset's bytes are gone (the OPFS copy was
// reaped, the drive left), an export must say so instead of rendering black
// frames and reporting success.

const removeOpfsKey = async (page: Page, suffix: string): Promise<void> => {
  const key = (await opfsKeys(page)).find((k) => k.endsWith(suffix));
  expect(key, `an OPFS key ending in ${suffix}`).toBeTruthy();
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  }, key as string);
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("an export with missing media is refused by name and the dialog stays usable", async ({
  page,
}) => {
  await seedTimeline(page, 1);
  await removeOpfsKey(page, "__pix.png");
  // The card still shows the inline thumbnail, so nothing in the bin warns yet.
  await expect(mediaCard(page)).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Family message 720p").uncheck();
  await dialog.getByLabel("Web (VP9 · MP4)").check();

  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();

  await expect(page.getByText(/^Cannot export: media is missing \(pix\.png\)/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/^Exported: /)).toHaveCount(0);
  // Give a download that raced the toast a moment to show up before asserting.
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});
