import { type Page, expect, test } from "@playwright/test";

// Regression guards for the finishing steps (B22): an export produces a
// playable file, cancelling mid-render leaves the dialog usable, and a
// snapshot brings the timeline back. Runs in Playwright's Chromium, which has
// no H.264 or AAC encoder — the VP9 preset exercises the real encoder path
// and the exporter degrades to video-only instead of failing.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
};

// The media-bin card, as opposed to the clips on the timeline that carry the
// same file name.
const mediaCard = (page: Page) => page.getByRole("button", { name: /^pix\.png/ }).first();

// One still image appended a few times: the cheapest timeline that still
// renders through the compositor and the encoder. Returns how many clips
// landed — the import itself may place the first one.
const seedTimeline = async (page: Page, presses: number): Promise<number> => {
  await page.goto("/editor");
  await page
    .locator('input[type="file"][accept="video/*,audio/*,image/*"]')
    .setInputFiles({ name: "pix.png", mimeType: "image/png", buffer: PNG });
  await mediaCard(page).click();
  for (let i = 0; i < presses; i++) await page.keyboard.press("e");
  await expect.poll(() => page.locator("[data-clip]").count()).toBeGreaterThanOrEqual(presses);
  await page.waitForTimeout(300);
  return page.locator("[data-clip]").count();
};

const openExportWithVp9 = async (page: Page) => {
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Family message 720p").uncheck();
  await dialog.getByLabel("Web (VP9 · MP4)").check();
  return dialog;
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("explains sharing presets and keeps the dialog inside a compact viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Est\. 0 MB · \d+ MB\/min/).first()).toBeVisible();
  await expect(dialog.getByLabel("Family message 720p")).toBeChecked();
  await expect(dialog.getByLabel("TV / Tablet 4K")).not.toBeChecked();

  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(844);
});

test("exports the timeline to a non-empty MP4 with the VP9 preset", async ({ page }) => {
  test.setTimeout(180_000);
  await seedTimeline(page, 1);
  const dialog = await openExportWithVp9(page);

  const download = page.waitForEvent("download", { timeout: 150_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);
  const path = await file.path();
  expect(path).toBeTruthy();
  const { size } = await import("node:fs/promises").then((fs) => fs.stat(path as string));
  expect(size).toBeGreaterThan(1024);
  await expect(page.getByText(/^Exported: .*\.mp4$/)).toBeVisible();
});

test("cancelling a running export reports a cancel and leaves the dialog usable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedTimeline(page, 3);
  const dialog = await openExportWithVp9(page);

  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Exporting…" })).toBeDisabled();
  await expect(dialog.getByText(/preparing|rendering/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("Export cancelled", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/^Export failed/)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});

test("restoring a snapshot brings the timeline back to the saved state", async ({ page }) => {
  const saved = await seedTimeline(page, 2);

  await page.getByRole("button", { name: "Snapshots" }).click();
  await page.getByPlaceholder("Snapshot name…").fill("two clips");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Snapshot saved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await mediaCard(page).click();
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await expect.poll(() => page.locator("[data-clip]").count()).toBeGreaterThan(saved);

  await page.getByRole("button", { name: "Snapshots" }).click();
  await expect(page.getByText("two clips", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByText("Snapshot restored", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator("[data-clip]").count()).toBe(saved);
});
