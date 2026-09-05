import { expect, test } from "@playwright/test";
import { PNG, configurePage, importMediaFiles, mediaCard, revealMediaCard } from "./support";

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

const files = Array.from({ length: 40 }, (_, index) => ({
  name: `virtual-${String(index).padStart(2, "0")}.png`,
  mimeType: "image/png",
  buffer: PNG,
}));

test("cards unmount outside the scrolled virtual window and return", async ({ page }) => {
  await page.goto("/editor");
  await importMediaFiles(page, files);
  await expect(page.getByTestId("media-count")).toHaveText("40/40");
  expect(await page.locator("[data-asset-card]").count()).toBeLessThan(40);

  await revealMediaCard(page, "virtual-39.png");
  await expect(mediaCard(page, "virtual-39.png")).toBeVisible();
  await expect(mediaCard(page, "virtual-00.png")).toHaveCount(0);

  await revealMediaCard(page, "virtual-00.png");
  await expect(mediaCard(page, "virtual-00.png")).toBeVisible();
  await expect(mediaCard(page, "virtual-39.png")).toHaveCount(0);
});

test("a marquee over the first row selects exactly its cards", async ({ page }) => {
  await page.goto("/editor");
  await importMediaFiles(page, files);
  await expect(page.getByTestId("media-count")).toHaveText("40/40");
  const cards = page.locator("[data-asset-card]");
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (!first || !second) return;

  await page.mouse.move(second.x + second.width - 1, first.y + first.height + 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 1, first.y + 1, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("bulk-bar")).toContainText("2 selected");
});
