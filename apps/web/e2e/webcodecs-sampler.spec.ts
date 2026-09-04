import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { installDecoderStats, readDecoderStats } from "./decoder-stats";
import { importMediaFiles } from "./support";

// Smoke for the shared analysis frame sampler (B15): importing an MP4 must
// analyse it through a real VideoDecoder — configure() accepted and frames
// delivered — rather than the media-element fallback. VP9-in-MP4 because
// Playwright's Chromium ships no H.264/HEVC decoder.

const FIXTURE = "vp9_clip.mp4";

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
  await installDecoderStats(page);
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("analysis decodes an MP4 through a real VideoDecoder", async ({ page }) => {
  test.setTimeout(120_000);
  const fixtureDir = path.join(test.info().project.testDir, "fixtures");

  await page.goto("/editor");
  await importMediaFiles(page, path.join(fixtureDir, FIXTURE));
  await expect(page.getByText(FIXTURE, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Auto edit" }).click();
  await expect(page.getByText("1/1", { exact: true })).toBeVisible({ timeout: 90_000 });

  const stats = await readDecoderStats(page);
  test.info().annotations.push({ type: "decoder-stats", description: JSON.stringify(stats) });
  expect(stats?.configures.length ?? 0).toBeGreaterThan(0);
  expect(stats?.frames ?? 0).toBeGreaterThan(0);
});
