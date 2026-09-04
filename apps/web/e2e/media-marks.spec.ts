import { expect, test } from "@playwright/test";
import { PNG, clipCount, configurePage, importMediaFiles, mediaCard } from "./support";

// Library marks and collections (A3): rating, favourite and tags are set
// on a selection, filter the bin, and survive a reload; a manual collection
// filters by membership and a smart collection re-applies a saved search.

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

const matchCount = (page: Parameters<typeof mediaCard>[0]) => page.getByTestId("media-match-count");

test("marks a selection, filters by the marks, and keeps them across a reload", async ({
  page,
}) => {
  await page.goto("/editor");
  await importMediaFiles(page, [
    { name: "beach.png", mimeType: "image/png", buffer: PNG },
    { name: "cafe.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(mediaCard(page, "beach.png")).toBeVisible();
  await expect(mediaCard(page, "cafe.png")).toBeVisible();

  // Select beach → rate 4, favourite, tag "sea" and "Trip" in one entry.
  await mediaCard(page, "beach.png").click({ modifiers: ["Meta"] });
  const bulk = page.getByTestId("bulk-bar");
  await expect(bulk).toBeVisible();
  await bulk.getByRole("radio", { name: "Rate 4" }).click();
  await bulk.getByTestId("bulk-favorite").click();
  await bulk.getByLabel("Add tag…").fill("sea, Trip");
  await bulk.getByLabel("Add tag…").press("Enter");
  const beachMarks = mediaCard(page, "beach.png").getByTestId("card-marks");
  await expect(beachMarks).toContainText("4");
  await expect(beachMarks).toContainText("#2");
  // Tags are removable from the selection, and the chip row follows.
  await bulk.getByTestId("bulk-tags").getByRole("button", { name: "Remove tag Trip" }).click();
  await expect(beachMarks).toContainText("#1");
  await bulk.getByLabel("Add tag…").fill("Trip");
  await bulk.getByLabel("Add tag…").press("Enter");
  await expect(beachMarks).toContainText("#2");
  await expect(beachMarks.getByLabel("Favourite")).toBeVisible();
  await expect(mediaCard(page, "cafe.png").getByTestId("card-marks")).toHaveCount(0);
  // Clicking the lit star again clears the rating; undo brings it back.
  await bulk.getByRole("radio", { name: "Rate 4" }).click();
  await expect(beachMarks).not.toContainText("4");
  await page.keyboard.press("Meta+z");
  await expect(beachMarks).toContainText("4");
  await bulk.getByTitle("Deselect").click();
  await expect(bulk).toHaveCount(0);

  // Filters: tag chip, minimum rating, favourites only, #tag search.
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(matchCount(page)).toHaveText("2 of 2");
  const seaChip = page.getByTestId("media-tag-filters").getByRole("button", { name: /#sea/ });
  await seaChip.click();
  await expect(matchCount(page)).toHaveText("1 of 2");
  await expect(mediaCard(page, "cafe.png")).toHaveCount(0);
  await seaChip.click();
  await expect(matchCount(page)).toHaveText("2 of 2");
  await page.getByLabel("Rating").selectOption("5");
  await expect(matchCount(page)).toHaveText("0 of 2");
  await page.getByLabel("Rating").selectOption("4");
  await expect(matchCount(page)).toHaveText("1 of 2");
  await page.getByLabel("Rating").selectOption("0");
  await page.getByLabel("Favourites only").check();
  await expect(matchCount(page)).toHaveText("1 of 2");
  await page.getByLabel("Favourites only").uncheck();
  const search = page.getByPlaceholder("Search media…");
  await search.fill("#trip");
  await expect(matchCount(page)).toHaveText("1 of 2");
  await search.fill("#tri"); // prefix: still narrows while typing
  await expect(matchCount(page)).toHaveText("1 of 2");
  await search.fill("#rip");
  await expect(matchCount(page)).toHaveText("0 of 2");
  await search.fill("");

  // Usage follows the timeline: adding a card makes it "used".
  const placed = await clipCount(page);
  await mediaCard(page, "cafe.png").click();
  await expect.poll(() => clipCount(page)).toBeGreaterThan(placed);
  await page.getByLabel("Usage").selectOption("used");
  await expect(mediaCard(page, "cafe.png")).toBeVisible();
  await page.getByLabel("Usage").selectOption("unused");
  await expect(mediaCard(page, "cafe.png")).toHaveCount(0);
  await page.getByLabel("Usage").selectOption("any");

  // Reload: the marks live in the project document.
  await page.reload();
  await expect(mediaCard(page, "beach.png").getByTestId("card-marks")).toContainText("4");
  await expect(mediaCard(page, "beach.png").getByTestId("card-marks")).toContainText("#2");
});

test("manual collections filter by membership and smart collections re-apply a search", async ({
  page,
}) => {
  await page.goto("/editor");
  await importMediaFiles(page, [
    { name: "beach.png", mimeType: "image/png", buffer: PNG },
    { name: "cafe.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(mediaCard(page, "cafe.png")).toBeVisible();

  // New collection from the selection: the bin switches to it.
  await mediaCard(page, "cafe.png").click({ modifiers: ["Meta"] });
  const bulk = page.getByTestId("bulk-bar");
  await bulk.getByLabel("Add to collection").selectOption("__new__");
  await bulk.getByLabel("Collection name").fill("Trip");
  await bulk.getByLabel("Collection name").press("Enter");
  await bulk.getByTitle("Deselect").click();
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(matchCount(page)).toHaveText("1 of 2");
  await expect(page.getByLabel("Collection", { exact: true })).toHaveValue(/.+/);
  await expect(mediaCard(page, "beach.png")).toHaveCount(0);

  // Add beach through the collection select, rename, then delete.
  await page.getByLabel("Collection", { exact: true }).selectOption("");
  await mediaCard(page, "beach.png").click({ modifiers: ["Meta"] });
  await bulk.getByLabel("Add to collection").selectOption({ label: "Trip" });
  await bulk.getByTitle("Deselect").click();
  await page.getByLabel("Collection", { exact: true }).selectOption({ label: "Trip" });
  await expect(matchCount(page)).toHaveText("2 of 2");
  // Taking the selection out of the filtered collection hides it again.
  await mediaCard(page, "beach.png").click({ modifiers: ["Meta"] });
  await bulk.getByRole("button", { name: "Remove from collection" }).click();
  await expect(matchCount(page)).toHaveText("1 of 2");
  await bulk.getByTitle("Deselect").click();
  await page.getByRole("button", { name: "Rename collection" }).click();
  await page.getByLabel("Rename collection").fill("Trip 2026");
  await page.getByLabel("Rename collection").press("Enter");
  await expect(page.getByLabel("Collection", { exact: true })).toContainText("Trip 2026");

  // Smart collection: save "#sea", reset, re-apply from the select. The
  // membership filter is cleared first (beach is no longer a member).
  await page.getByLabel("Collection", { exact: true }).selectOption("");
  await mediaCard(page, "beach.png").click({ modifiers: ["Meta"] });
  await bulk.getByLabel("Add tag…").fill("sea");
  await bulk.getByLabel("Add tag…").press("Enter");
  await bulk.getByTitle("Deselect").click();
  const search = page.getByPlaceholder("Search media…");
  await search.fill("#sea");
  await expect(matchCount(page)).toHaveText("1 of 2");
  await page.getByRole("button", { name: "Save search as smart collection" }).click();
  await page.getByLabel("Save search as smart collection").fill("Sea shots");
  await page.getByLabel("Save search as smart collection").press("Enter");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(matchCount(page)).toHaveText("2 of 2");
  await page.getByLabel("Collection", { exact: true }).selectOption({ label: "Smart: Sea shots" });
  await expect(search).toHaveValue("#sea");
  await expect(matchCount(page)).toHaveText("1 of 2");

  // Both collections survive a reload; either kind can be deleted, and the
  // deletion toast undoes it.
  await page.reload();
  await expect(mediaCard(page, "cafe.png")).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();
  const select = page.getByLabel("Collection", { exact: true });
  await expect(select.getByRole("option")).toHaveText([
    "All media",
    "Trip 2026",
    "Smart: Sea shots",
  ]);
  await select.selectOption({ label: "Trip 2026" });
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(select.getByRole("option")).toHaveText(["All media", "Smart: Sea shots"]);
  await expect(matchCount(page)).toHaveText("2 of 2");
  await select.selectOption({ label: "Smart: Sea shots" });
  await expect(matchCount(page)).toHaveText("1 of 2");
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(select.getByRole("option")).toHaveText(["All media"]);
  await page
    .locator("[data-sonner-toast]", { hasText: "Sea shots" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(select.getByRole("option")).toHaveText(["All media", "Smart: Sea shots"]);
});
