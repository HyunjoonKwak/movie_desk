import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { configurePage, importMediaFiles, mediaCard, PNG } from "./support";

test("local opt-in completion report, private JSON, disable and clear at 390px", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configurePage(page);
  await page.goto("/editor");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("Usage measurement (local)").check();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await importMediaFiles(page, { name: "private-funnel.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "private-funnel.png")).toBeVisible();
  await mediaCard(page, "private-funnel.png").click();
  await page.keyboard.press("e");
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Family message 720p").uncheck();
  await dialog.getByLabel("Web (VP9 · MP4)").check();
  const output = page.waitForEvent("download", { timeout: 150_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await output;
  await expect(dialog.locator("[data-export-complete]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Measurement report", exact: true }).click();
  await expect(page.getByTestId("funnel-rate")).toHaveText("First completion rate: 1/1 (100%)");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download measurement JSON" }).click();
  const file = await download;
  const text = await readFile((await file.path())!, "utf8");
  const payload = JSON.parse(text);
  expect(payload.rows.length).toBeGreaterThan(4);
  expect(text).not.toContain("private-funnel");
  expect(
    payload.rows.every((row: { projectId: string }) => /^[a-f0-9]{64}$/.test(row.projectId)),
  ).toBe(true);
  await page.getByRole("button", { name: "Close report" }).click();
  await page.getByLabel("Usage measurement (local)").uncheck();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await importMediaFiles(page, { name: "off.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "off.png")).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Measurement report", exact: true }).click();
  const offDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download measurement JSON" }).click();
  expect(JSON.parse(await readFile((await (await offDownload).path())!, "utf8"))).toEqual(payload);
  await page.getByRole("button", { name: "Close report" }).click();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Measurement report", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Measurement report", exact: true });
  const bounds = await report.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await report.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Delete all records" }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page.getByTestId("funnel-rate")).toHaveText("First completion rate: 0/0 (—)");
});
