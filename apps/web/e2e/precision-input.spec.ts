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
  await duration.press("Tab");
  await expect(duration).toHaveValue(before);
  await expect(duration).toHaveAttribute("aria-invalid", "false");
  await duration.fill("00:00:02:00");
  const clip = page.locator("[data-clip]").first();
  const width = await clip.evaluate((el) => el.getBoundingClientRect().width);
  await duration.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await clip.evaluate((el) => el.getBoundingClientRect().width)).toBe(width);
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

test("slider and scrub show live values, undo once and keep deletion shortcuts inside the field", async ({
  page,
}) => {
  await seedTimeline(page, 1);
  const clips = page.locator("[data-clip]");
  await clips.first().click();
  const count = await clips.count();
  const input = page.getByRole("spinbutton", { name: "Scale", exact: true });
  const slider = page.getByRole("slider", { name: "Scale slider", exact: true });
  const before = await input.inputValue();
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 5 });
  await expect(input).not.toHaveValue(before);
  const live = await input.inputValue();
  await page.mouse.up();
  await expect(input).toHaveValue(live);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(input).toHaveValue(before);

  const scrub = page.getByRole("button", { name: "Scrub Scale", exact: true });
  await scrub.scrollIntoViewIfNeeded();
  const handle = (await scrub.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 20, handle.y + handle.height / 2, {
    steps: 5,
  });
  await expect(slider).toHaveValue("1.2");
  await page.mouse.up();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(count);
  await expect(input).toHaveValue("1.2");
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(input).toHaveValue(before);
});

test("clip selection preserves inspector sections and still images have no source trim UI", async ({
  page,
}) => {
  await seedTimeline(page, 1);
  const clips = page.locator("[data-clip]");
  await clips.first().click();
  const transform = page.getByRole("button", { name: "Transform", exact: true });
  await transform.click();
  await expect(page.getByRole("spinbutton", { name: "Scale", exact: true })).toBeHidden();
  await clips.nth(1).click();
  await expect(page.getByRole("spinbutton", { name: "Scale", exact: true })).toBeHidden();
  await expect(page.getByRole("spinbutton", { name: "Source in", exact: true })).toBeHidden();
  await expect(page.getByRole("spinbutton", { name: "Source out", exact: true })).toBeHidden();
  await expect(page.getByRole("slider", { name: /Slip/ })).toBeHidden();
});
