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

test("an active offscreen segment stays mounted without changing virtual height", async ({ page }) => {
  await page.goto("/editor");
  await importMediaFiles(page, files);
  await expect(page.getByTestId("media-count")).toHaveText("40/40");
  expect(await page.locator("[data-asset-card]").count()).toBeLessThan(40);

  await revealMediaCard(page, "virtual-00.png");
  await mediaCard(page, "virtual-00.png").click();
  await revealMediaCard(page, "virtual-39.png");
  await expect(mediaCard(page, "virtual-39.png")).toBeVisible();
  await expect(mediaCard(page, "virtual-00.png")).not.toBeInViewport();
  const geometry = await page.getByTestId("media-scroll").evaluate((scroll) => {
    const cards = scroll.querySelector<HTMLElement>('[data-testid="media-cards"]');
    if (!cards) return null;
    const paddingBottom = Number.parseFloat(getComputedStyle(scroll).paddingBottom);
    return {
      actual: scroll.scrollHeight,
      expected: cards.offsetTop + Number(cards.dataset.layoutHeight) + paddingBottom,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry?.actual).toBe(geometry?.expected);

  await revealMediaCard(page, "virtual-00.png");
  await expect(mediaCard(page, "virtual-00.png")).toBeVisible();
  await expect(mediaCard(page, "virtual-39.png")).toHaveCount(0);
});

test("a marquee after scrolling several segments selects exactly one row", async ({ page }) => {
  await page.goto("/editor");
  await importMediaFiles(page, files);
  await expect(page.getByTestId("media-count")).toHaveText("40/40");
  await revealMediaCard(page, "virtual-00.png");
  await mediaCard(page, "virtual-00.png").click();
  await revealMediaCard(page, "virtual-32.png");
  await mediaCard(page, "virtual-32.png").evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const first = await mediaCard(page, "virtual-32.png")
    .locator("xpath=ancestor::li[1]")
    .boundingBox();
  const second = await mediaCard(page, "virtual-33.png")
    .locator("xpath=ancestor::li[1]")
    .boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (!first || !second) return;

  await page.mouse.move(second.x + second.width - 1, first.y + first.height + 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 1, first.y + 1, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("bulk-bar")).toContainText("2 selected");
});

test("group headers stay inside the fixed layout row at narrow panel widths", async ({ page }) => {
  await page.goto("/editor");
  await importMediaFiles(page, files.slice(0, 2));
  await expect(page.getByTestId("media-count")).toHaveText("2/2");
  const panel = page.getByTestId("media-scroll").locator("xpath=ancestor::*[@data-panel][1]");
  const header = page.locator("[data-group-header]").first();
  for (const width of [173, 200, 240]) {
    await panel.evaluate((element, pixels) => {
      element.style.flex = `0 0 ${pixels}px`;
    }, width);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect
      .poll(async () => {
        const wrapperBox = await header.boundingBox();
        const buttonBox = await header.getByRole("button").boundingBox();
        expect(wrapperBox).not.toBeNull();
        expect(buttonBox).not.toBeNull();
        if (!wrapperBox || !buttonBox) return null;
        const overflow = await header.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        );
        return { wrapper: wrapperBox.height, button: buttonBox.height, overflow };
      })
      .toEqual({ wrapper: 21, button: 16, overflow: 0 });
  }
});
