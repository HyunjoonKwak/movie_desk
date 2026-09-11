import { expect, test } from "@playwright/test";
import { clipCount, configurePage, importMediaFiles, mediaCard, toneWav } from "./support";

interface StoreWindow {
  __cutStore: {
    getState: () => {
      project: { timeline: { tracks: { clips: { volume?: number }[] }[] } };
    };
  };
}

const clipVolume = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      (window as unknown as StoreWindow).__cutStore
        .getState()
        .project.timeline.tracks.flatMap((track) => track.clips)[0]?.volume,
  );

test("dragging the volume line on a clip sets its gain in one undo step", async ({ page }) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "tone.wav", mimeType: "audio/wav", buffer: toneWav(2) });
  await expect(mediaCard(page, "tone.wav")).toBeVisible();
  await mediaCard(page, "tone.wav").click();
  await page.keyboard.press("e");
  await expect.poll(() => clipCount(page)).toBe(1);

  const line = page.getByTestId("clip-volume-line");
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-volume", "1.00");

  // Up raises the gain, and the readout follows during the drag.
  const box = (await line.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 6, { steps: 3 });
  await expect(line).toContainText("dB");
  await page.mouse.move(x, y - 12, { steps: 3 });
  await page.mouse.up();
  const raised = await clipVolume(page);
  expect(raised).toBeGreaterThan(1);
  await expect(line).toHaveAttribute("data-volume", raised!.toFixed(2));

  // One undo restores the previous gain; double-click returns to 100 %.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => clipVolume(page)).not.toBe(raised);
  await expect(line).toHaveAttribute("data-volume", "1.00");
  await page.mouse.dblclick(x, y);
  await expect(line).toHaveAttribute("data-volume", "1.00");
});
