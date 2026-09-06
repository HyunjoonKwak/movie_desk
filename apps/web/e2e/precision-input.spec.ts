import { expect, test } from "@playwright/test";
import { configurePage, seedTimeline } from "./support";

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("typed duration updates timeline on commit and one undo restores it", async ({ page }) => {
  await seedTimeline(page, 1);
  const clip = page.locator("[data-clip]").first();
  await clip.click();
  const duration = page.getByRole("spinbutton", { name: "Duration", exact: true });
  const before = await duration.inputValue();
  const width = await clip.evaluate((el) => el.getBoundingClientRect().width);
  await duration.fill("00:00:02:00");
  expect(await clip.evaluate((el) => el.getBoundingClientRect().width)).toBe(width);
  await duration.press("Enter");
  await expect(duration).toHaveValue("00:00:02:00");
  await expect
    .poll(() => clip.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThan(width);
  await expect(duration).toHaveAttribute("aria-valuetext", "00:00:02:00");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(duration).toHaveValue(before);
  expect(await clip.evaluate((el) => el.getBoundingClientRect().width)).toBe(width);
});

test("invalid input and Escape do not edit; arrow session commits on blur", async ({ page }) => {
  await seedTimeline(page, 1);
  await page.locator("[data-clip]").first().click();
  const duration = page.getByRole("spinbutton", { name: "Duration", exact: true });
  const before = await duration.inputValue();
  await duration.fill("00:99:00:00");
  await duration.press("Enter");
  await expect(duration).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid value" })).toBeVisible();
  await duration.press("Escape");
  await expect(duration).toHaveValue(before);
  await duration.press("ArrowUp");
  await duration.press("Shift+ArrowUp");
  await duration.press("Alt+ArrowDown");
  await duration.press("Tab");
  await expect(duration).not.toHaveValue(before);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(duration).toHaveValue(before);
});
