import path from "node:path";
import { type Page, expect, test as base } from "@playwright/test";
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

// Contexts isolate storage, but the default browser shares a GPU process across
// specs. Own a browser here so preceding export/compositor tests cannot retain
// decoder/GPU resources in the process used by this analysis smoke.
const test = base.extend({
  browser: [
    async ({ playwright, browserName, launchOptions }, use) => {
      const browser = await playwright[browserName].launch(launchOptions);
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: "worker" },
  ],
});

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await test.info().attach("decoder-stats", {
    body: JSON.stringify(await readDecoderStats(page)),
    contentType: "application/json",
  });
});

test("analysis decodes an MP4 through a real VideoDecoder", async ({ page }) => {
  test.setTimeout(120_000);
  const fixtureDir = path.join(test.info().project.testDir, "fixtures");

  await page.goto("/editor");
  await importMediaFiles(page, path.join(fixtureDir, FIXTURE));
  await expect(page.getByText(FIXTURE, { exact: true })).toBeVisible();

  const before = await readDecoderStats(page);
  await page.getByRole("button", { name: "Auto edit" }).click();
  await expect(page.getByText("1/1", { exact: true })).toBeVisible({ timeout: 90_000 });

  // Completion text alone also covers a media-element fallback. Wait for
  // actual decoder output, and preserve stats even when completion times out.
  await expect
    .poll(async () => (await readDecoderStats(page))?.frames ?? 0)
    .toBeGreaterThan(before?.frames ?? 0);
  const stats = await readDecoderStats(page);
  test.info().annotations.push({ type: "decoder-stats", description: JSON.stringify(stats) });
  expect(stats?.configures.length ?? 0).toBeGreaterThan(0);
  expect(stats?.frames ?? 0).toBeGreaterThan(0);
});
