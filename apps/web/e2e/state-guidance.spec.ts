import { expect, test } from "@playwright/test";
import { PNG, configurePage, importMediaFiles, mediaCard } from "./support";

test("empty project explains the next step and imports through its hint", async ({ page }) => {
  await configurePage(page);
  await page.goto("/editor");
  await page.getByRole("button", { name: "Open empty editor" }).click();
  await expect(page.getByTestId("media-empty-hint")).toContainText("Your library is empty");
  await expect(page.getByTestId("timeline-state-hint")).toContainText("There are no clips yet");
  await expect(page.getByTestId("preview-empty-hint")).toBeVisible();
  await expect(page.getByTestId("inspector-empty-hint")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("media-empty-hint").getByRole("button").click();
  await (await chooser).setFiles({ name: "hint.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "hint.png")).toBeVisible();
  await expect(page.getByTestId("media-empty-hint")).toBeHidden();
  // Imported media alone does not make a timeline preview.
  await expect(page.getByTestId("preview-empty-hint")).toBeVisible();
});

test("Korean hints wrap at the media minimum width and reset an empty search", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("cut.persistence.welcomed", "1"));
  await page.goto("/editor");
  await page.getByRole("button", { name: "빈 편집기 열기" }).click();
  const handle = page
    .locator('[data-panel-resize-handle-id][data-panel-group-direction="horizontal"]')
    .first();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing panel resize handle");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(140, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  const panelWidth = await page
    .getByTestId("media-scroll")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(panelWidth).toBeGreaterThan(170);
  expect(panelWidth).toBeLessThan(174);
  await page.screenshot({ path: testInfo.outputPath("ko-empty-min-width.png") });
  await page.getByRole("button", { name: "자동 편집", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("ko-auto-empty-min-width.png") });
  await page.getByRole("button", { name: "속성", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("media-empty-hint").getByRole("button").click();
  await (await chooser).setFiles({ name: "hint.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "hint.png")).toBeVisible();
  await page.locator('[data-testid="media-controls"] input').first().fill("no-such-file");
  const hint = page.getByTestId("media-filtered-hint");
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ko-filtered-min-width.png") });
  await hint.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page.getByTestId("media-count")).toHaveText("1/1");
  await expect(mediaCard(page, "hint.png")).toBeVisible();
});
