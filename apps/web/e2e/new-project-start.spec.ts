import { expect, test } from "@playwright/test";
import { PNG, configurePage } from "./support";

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("offers three real starting paths for a fresh project", async ({ page }) => {
  await page.goto("/editor");

  const start = page.getByTestId("new-project-start");
  await expect(start).toBeVisible();
  await expect(start.getByRole("heading", { name: "Import and organize" })).toBeVisible();
  await expect(start.getByRole("heading", { name: "Edit manually" })).toBeVisible();
  await expect(start.getByRole("heading", { name: "Build a guided draft" })).toBeVisible();
  await expect(
    start.getByText("Every path opens the same complete editing workspace."),
  ).toBeVisible();
  await expect(start.getByText("Your media and analysis stay on this device.")).toBeVisible();
});

test("manual editing keeps the existing empty expert editor", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("button", { name: "Open empty editor" }).click();

  await expect(page.getByTestId("new-project-start")).toBeHidden();
  await expect(
    page.getByText("Drop video / audio / image or a folder", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("new-project-start")).toBeHidden();
  await expect(
    page.getByText("Drop video / audio / image or a folder", { exact: true }),
  ).toBeVisible();
});

test("import and organize enters the existing organized media workspace", async ({ page }) => {
  await page.goto("/editor");
  await page
    .getByTestId("new-project-start")
    .locator('input[type="file"][accept="video/*,audio/*,image/*"]')
    .setInputFiles({ name: "first-day.png", mimeType: "image/png", buffer: PNG });

  await expect(page.getByTestId("new-project-start")).toBeHidden();
  await expect(page.getByText("first-day.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("captured");
});

test("guided draft opens the editable auto-edit workflow", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("button", { name: "Start guided draft" }).click();

  await expect(page.getByTestId("new-project-start")).toBeHidden();
  await expect(page.getByText("Your footage at a glance", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Import photos or videos to see which moments may work/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto edit" })).toBeVisible();
});

test("creating another project shows the start choices again", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("button", { name: "Open empty editor" }).click();
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("new-project-start")).toBeVisible();
});

for (const viewport of [
  { name: "compact", width: 900, height: 620 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`keeps the ${viewport.name} start layout inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/editor");
    await expect(page.getByTestId("new-project-start")).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Open empty editor" })).toBeInViewport();
  });
}
