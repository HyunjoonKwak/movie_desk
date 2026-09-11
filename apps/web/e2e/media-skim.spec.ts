import { type Page, expect, test } from "@playwright/test";
import { PNG, configurePage, importMediaFiles, mediaCard } from "./support";

interface StoreWindow {
  __cutStore: {
    getState: () => {
      project: {
        mediaLibrary: { name: string; durationMs: number; useInMs?: number; useOutMs?: number }[];
      };
    };
  };
}

const renderedPlayhead = (page: Page) =>
  page
    .locator("[data-preview-canvas]")
    .getAttribute("data-render-playhead")
    .then((value) => Number(value));

const asset = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as StoreWindow).__cutStore
      .getState()
      .project.mediaLibrary.find((a) => a.name === "pix.png"),
  );

test("skimming a card draws that time in the viewer and the bottom strip sets the use range", async ({
  page,
}) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "pix.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page)).toBeVisible();
  const duration = (await asset(page))?.durationMs ?? 0;
  expect(duration).toBeGreaterThan(0);

  // Hover at 30 % of the picture: the viewer shows the source there, no click needed.
  const preview = mediaCard(page).getByTestId("card-preview");
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(page.locator('[data-viewer-mode="source"]')).toBeVisible();
  await expect(page.getByTestId("skim-name")).toHaveText("pix.png");
  await expect(mediaCard(page).getByTestId("card-skim-line")).toBeVisible();
  await expect.poll(() => renderedPlayhead(page)).toBeGreaterThan(duration * 0.2);
  expect(await renderedPlayhead(page)).toBeLessThan(duration * 0.4);

  // Leaving the card hands the viewer back.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120);
  await expect(page.locator('[data-viewer-mode="timeline"]')).toBeVisible();

  // Dragging the bottom strip from 20 % to 60 % marks the use range and views the source.
  const strip = mediaCard(page).getByTestId("card-range-strip");
  const sbox = (await strip.boundingBox())!;
  const y = sbox.y + sbox.height / 2;
  await page.mouse.move(sbox.x + sbox.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width * 0.4, y, { steps: 4 });
  await page.mouse.move(sbox.x + sbox.width * 0.6, y, { steps: 4 });
  await page.mouse.up();
  const marked = await asset(page);
  expect(marked?.useInMs).toBeGreaterThan(duration * 0.15);
  expect(marked?.useInMs).toBeLessThan(duration * 0.25);
  expect(marked?.useOutMs).toBeGreaterThan(duration * 0.55);
  expect(marked?.useOutMs).toBeLessThan(duration * 0.65);
  await expect(page.getByTestId("source-viewer-name")).toHaveText("pix.png");
  await expect(page.getByTestId("source-range-clear")).toBeEnabled();
});
