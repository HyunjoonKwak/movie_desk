import { expect, test } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
});

test("keeps good files and explains a damaged file in the same import", async ({ page }) => {
  await page.goto("/editor");
  await page.locator('input[type="file"][accept="video/*,audio/*,image/*"]').setInputFiles([
    { name: "good.png", mimeType: "image/png", buffer: PNG },
    { name: "damaged.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") },
  ]);

  await expect(page.getByText("good.png", { exact: true })).toBeVisible();
  await expect(page.getByText("Could not import 1 file(s)", { exact: true })).toBeVisible();
  await expect(page.getByText("damaged.jpg", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/The file could not be decoded\. Copy the original again/),
  ).toBeVisible();
});
