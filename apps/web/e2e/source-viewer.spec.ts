import { type Page, expect, test } from "@playwright/test";
import { PNG, clipCount, configurePage, importMediaFiles, mediaCard } from "./support";

interface StoreWindow {
  __cutStore: {
    getState: () => {
      project: {
        timeline: {
          playhead: number;
          tracks: { clips: { trimIn?: number; trimOut?: number; duration: number }[] }[];
        };
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

test("a card click views the source; I/O mark its range and E places just that range", async ({
  page,
}) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "pix.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page)).toBeVisible();
  const placed = await clipCount(page);

  // Clicking browses; it no longer edits the timeline.
  await mediaCard(page).click();
  await expect(page.locator('[data-viewer-mode="source"]')).toBeVisible();
  await expect(page.getByTestId("source-viewer-name")).toHaveText("pix.png");
  await expect(page.locator('[data-transport-mode="source"]')).toBeVisible();
  expect(await clipCount(page)).toBe(placed);

  // The source transport moves the rendered frame, not the timeline playhead.
  await page.keyboard.press("Space");
  await expect.poll(() => renderedPlayhead(page)).toBeGreaterThan(300);
  await page.keyboard.press("k");
  const timelinePlayhead = await page.evaluate(
    () => (window as unknown as StoreWindow).__cutStore.getState().project.timeline.playhead,
  );
  expect(timelinePlayhead).toBe(0);

  // Mark in at 20 % and out at 60 % of the still's duration.
  const scrub = page.getByTestId("source-scrub");
  const scrubTo = async (fraction: number) => {
    const box = (await scrub.boundingBox())!;
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  };
  await expect(page.getByTestId("source-range-clear")).toBeDisabled();
  await scrubTo(0.2);
  await page.keyboard.press("i");
  await scrubTo(0.6);
  await page.keyboard.press("o");
  const asset = await page.evaluate(() =>
    (window as unknown as StoreWindow).__cutStore
      .getState()
      .project.mediaLibrary.find((a) => a.name === "pix.png"),
  );
  const duration = asset?.durationMs ?? 0;
  expect(duration).toBeGreaterThan(0);
  expect(asset?.useInMs).toBeGreaterThan(duration * 0.15);
  expect(asset?.useInMs).toBeLessThan(duration * 0.25);
  expect(asset?.useOutMs).toBeGreaterThan(duration * 0.55);
  expect(asset?.useOutMs).toBeLessThan(duration * 0.65);
  await expect(page.getByTestId("source-range-clear")).toBeEnabled();

  // E places only the marked range and hands the viewer back to the timeline.
  await page.keyboard.press("e");
  await expect.poll(() => clipCount(page)).toBe(placed + 1);
  const clip = await page.evaluate(() => {
    const clips = (window as unknown as StoreWindow).__cutStore
      .getState()
      .project.timeline.tracks.flatMap((track) => track.clips);
    return clips[clips.length - 1];
  });
  expect(clip?.trimIn).toBe(asset?.useInMs);
  expect(clip?.trimOut).toBe(asset?.useOutMs);
  expect(clip?.duration).toBe((asset?.useOutMs ?? 0) - (asset?.useInMs ?? 0));
  await expect(page.locator('[data-viewer-mode="timeline"]')).toBeVisible();

  // Esc also hands it back, without an edit. The pointer leaves the card
  // first: hovering a card skims it into the viewer on its own.
  await mediaCard(page).click();
  await expect(page.locator('[data-viewer-mode="source"]')).toBeVisible();
  await page.mouse.move(700, 300);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-viewer-mode="timeline"]')).toBeVisible();
  await expect(page.locator('[data-transport-mode="timeline"]')).toBeVisible();
});
