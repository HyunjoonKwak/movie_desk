import { expect, test } from "@playwright/test";
import { MEDIA_INPUT, PNG, configurePage, mediaCard } from "./support";

// Library search (A2): free text narrows the bin, the filter panel combines
// with it, the count says how much is hidden, and reset brings it all back.

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("free text and filters narrow the library and can be reset", async ({ page }) => {
  await page.goto("/editor");
  await page.locator(MEDIA_INPUT).setInputFiles([
    { name: "beach.png", mimeType: "image/png", buffer: PNG },
    { name: "cafe.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(mediaCard(page, "beach.png")).toBeVisible();
  await expect(mediaCard(page, "cafe.png")).toBeVisible();

  const search = page.getByPlaceholder("Search media…");
  await search.fill("cafe");
  await expect(mediaCard(page, "cafe.png")).toBeVisible();
  await expect(mediaCard(page, "beach.png")).toHaveCount(0);

  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByTestId("media-match-count")).toHaveText("1 of 2");
  // A 1×1 image is neither video nor 4K: the filters hide it.
  await page.getByLabel("Resolution").selectOption("uhd");
  await expect(page.getByTestId("media-match-count")).toHaveText("0 of 2");
  await page.getByLabel("Resolution").selectOption("sd");
  await expect(page.getByTestId("media-match-count")).toHaveText("1 of 2");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByTestId("media-match-count")).toHaveText("2 of 2");
  await expect(mediaCard(page, "beach.png")).toBeVisible();
  await expect(search).toHaveValue("");
});
