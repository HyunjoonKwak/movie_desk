import { expect, test } from "@playwright/test";
import { clipCount, mediaCard, seedTimeline } from "./support";

test("several cuts share one library: create, name, fill, switch, delete, undo", async ({
  page,
}) => {
  const placed = await seedTimeline(page, 1);
  const select = page.getByTestId("cut-select");
  await expect(select.locator("option")).toHaveCount(1);
  await expect(page.getByTestId("cut-delete")).toBeDisabled();

  // A new cut starts empty over the same media.
  await page.getByTestId("cut-new").click();
  await expect(select.locator("option")).toHaveCount(2);
  await expect.poll(() => clipCount(page)).toBe(0);
  await expect(mediaCard(page)).toBeVisible();
  await page.getByTestId("cut-name").fill("Short");
  await page.keyboard.press("Enter");
  await expect(select.locator("option").nth(1)).toHaveText("Short");

  // Fill it, then step back to the first cut, which is untouched.
  await mediaCard(page).click();
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await expect.poll(() => clipCount(page)).toBe(2);
  await select.selectOption({ index: 0 });
  await expect.poll(() => clipCount(page)).toBe(placed);
  await select.selectOption({ index: 1 });
  await expect.poll(() => clipCount(page)).toBe(2);

  // Deleting the second cut lands on the first; one undo brings it back.
  await page.getByTestId("cut-delete").click();
  await expect(select.locator("option")).toHaveCount(1);
  await expect.poll(() => clipCount(page)).toBe(placed);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(select.locator("option").nth(1)).toHaveText("Short");
});
