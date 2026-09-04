import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { importMediaFiles } from "./support";

// Regression guard for the existing auto-edit journey: import → background
// analysis → "Generate rough cut" → AUTO tracks on the timeline → one undo
// removes everything it placed. It protects the pipeline, not the quality of
// the cut, so it only asserts that clips landed and that undo is atomic.
//
// Fixtures are VP9/Opus WebM because Playwright's Chromium has no H.264
// decoder; the desktop app (Electron) and Chrome do, so real footage is MP4.

const FIXTURES = ["day1_morning.webm", "day1_noon.webm", "day2_morning.webm"];

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("generates a rough cut on AUTO tracks and one undo removes it", async ({ page }) => {
  test.setTimeout(240_000); // analysis samples every clip frame by frame
  const fixtureDir = path.join(test.info().project.testDir, "fixtures");

  await page.goto("/editor");
  await importMediaFiles(
    page,
    FIXTURES.map((name) => path.join(fixtureDir, name)),
  );
  for (const name of FIXTURES) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // Import starts analysis in the background; the wizard reports progress.
  await page.getByRole("button", { name: "Auto edit" }).click();
  await expect(page.getByText(`${FIXTURES.length}/${FIXTURES.length}`, { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(/Found about .* for a first cut\./)).toBeVisible();
  await expect(page.getByText(/Suggested starting point:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Emotional highlight" })).toBeVisible();

  const clipCount = () => page.locator("[data-clip]").count();
  expect(await clipCount()).toBe(0);

  await page.getByRole("button", { name: "Build a first cut with these settings" }).click();
  await expect(page.getByText("AUTO V", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(clipCount).toBeGreaterThan(0);

  // The whole generation is one history entry.
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.getByText("AUTO V", { exact: true })).toHaveCount(0);
  await expect.poll(clipCount).toBe(0);
});
