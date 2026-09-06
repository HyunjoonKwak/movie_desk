import { expect, test } from "@playwright/test";
import { PNG, configurePage, mediaCard, opfsKeys } from "./support";

test("empty project explains the next step and imports through its hint", async ({ page }) => {
  await configurePage(page);
  await page.addInitScript(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (this.name.endsWith("__hint.png")) {
        await new Promise<void>((resolve) => {
          (window as unknown as { releaseImport: () => void }).releaseImport = resolve;
        });
      }
      return original.apply(this, args);
    };
  });
  await page.goto("/editor");
  await page.getByRole("button", { name: "Open empty editor" }).click();
  await expect(page.getByTestId("media-empty-hint")).toBeVisible();
  await expect(page.getByTestId("timeline-state-hint")).toBeVisible();
  await expect(page.getByTestId("preview-empty-hint")).toBeVisible();
  expect(
    await page
      .getByTestId("preview-empty-hint")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(page.getByTestId("inspector-empty-hint")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("media-empty-hint").click({ position: { x: 5, y: 5 } });
  await (await chooser).setFiles({ name: "hint.png", mimeType: "image/png", buffer: PNG });
  const dropzone = page.getByTestId("media-empty-hint");
  await expect(dropzone).toBeDisabled();
  await expect(dropzone).toHaveAccessibleDescription(/Your library is empty/);
  await dropzone.evaluate((button) => {
    button.closest("section")!.addEventListener(
      "drop",
      (event) => {
        (window as unknown as { observedDrop: Event }).observedDrop = event;
      },
      { once: true },
    );
    const source = document.createElement("div");
    source.id = "disabled-drop-probe";
    source.draggable = true;
    source.textContent = "Drag probe";
    source.style.cssText =
      "position:fixed;left:400px;top:400px;width:100px;height:40px;z-index:9999;background:gray";
    source.addEventListener("dragstart", (event) =>
      event.dataTransfer?.setData("text/plain", "probe"),
    );
    document.body.append(source);
  });
  await page.locator("#disabled-drop-probe").dragTo(dropzone, { force: true });
  expect(
    await page.evaluate(() => {
      const event = (window as unknown as { observedDrop?: Event }).observedDrop;
      return event?.isTrusted === true && event.defaultPrevented;
    }),
  ).toBe(true);
  await page.locator("#disabled-drop-probe").evaluate((element) => element.remove());
  await page.waitForFunction(
    () => typeof (window as unknown as { releaseImport?: () => void }).releaseImport === "function",
  );
  await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport());
  await expect(mediaCard(page, "hint.png")).toBeVisible();
  await expect(page.getByTestId("media-empty-hint")).toBeHidden();
  // Imported media alone does not make a timeline preview.
  await expect(page.getByTestId("preview-empty-hint")).toBeVisible();
});

test("Korean hints wrap at the media minimum width and reset an empty search", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    localStorage.setItem("cut.persistence.welcomed", "1");
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "ko" }, version: 0 }));
  });
  await page.goto("/editor");
  await page.getByRole("button", { name: "빈 편집기 열기" }).click();
  const handle = page
    .locator('[data-panel-resize-handle-id][data-panel-group-direction="horizontal"]')
    .first();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing panel resize handle");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(140, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  const panelWidth = await page
    .getByTestId("media-scroll")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(panelWidth).toBeGreaterThan(170);
  expect(panelWidth).toBeLessThan(180);
  // Screenshots are documentation evidence, not pixel baselines.
  await page.screenshot({ path: testInfo.outputPath("ko-empty-min-width.png") });
  await page.getByRole("button", { name: "자동 편집", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("ko-auto-empty-min-width.png") });
  await page.getByRole("button", { name: "속성", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("media-empty-hint").click({ position: { x: 5, y: 5 } });
  await (await chooser).setFiles({ name: "hint.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "hint.png")).toBeVisible();
  await page.locator('[data-testid="media-controls"] input').first().fill("no-such-file");
  const hint = page.getByTestId("media-filtered-hint");
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ko-filtered-min-width.png") });
  await hint.getByRole("button", { name: "검색·필터 초기화" }).click();
  await expect(page.getByTestId("media-count")).toHaveText("1/1");
  await expect(mediaCard(page, "hint.png")).toBeVisible();
  await mediaCard(page, "hint.png").click();
  await page.keyboard.press("e");
  const clip = page.locator("[data-clip]").first();
  await expect(clip).toBeVisible();
  await clip.click();
  await expect(page.getByTestId("timeline-state-hint")).toBeHidden();
  await expect(page.getByTestId("preview-empty-hint")).toBeHidden();
  await page.getByRole("button", { name: "잠금", exact: true }).first().click();
  await expect(page.getByTestId("timeline-state-hint")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("ko-normal-edit-min-width.png") });
  const canvas = page.locator("[data-preview-canvas]");
  const canvasBefore = await canvas.boundingBox();
  const key = (await opfsKeys(page)).find((name) => name.endsWith("__hint.png"));
  if (!key) throw new Error("Imported source missing before test removal");
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.locator("[data-preview-missing]")).toBeVisible();
  await expect(page.locator("[data-preview-missing]").getByRole("alert")).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(canvasBefore);
  await page.screenshot({ path: testInfo.outputPath("ko-missing-min-width.png") });
  // Reveal names the target and focuses its card; only the card itself opens a chooser.
  await page.locator('[data-testid="media-controls"] input').first().fill("hide-all");
  let choosers = 0;
  page.on("filechooser", () => {
    choosers++;
  });
  const missingHint = page.getByTestId("media-missing-hint");
  await missingHint.getByRole("button", { name: "누락 미디어 보기: hint.png" }).click();
  await expect(mediaCard(page, "hint.png")).toBeFocused();
  expect(choosers).toBe(0);
  await missingHint.getByRole("button", { name: "이 안내 닫기" }).click();
  await expect(missingHint).toBeHidden();
  // A repaired set becoming missing again starts a new warning episode.
  // Focus probes are throttled for 10 seconds; allow a complete real probe cycle.
  await page.evaluate(
    async ({ name, bytes }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      await writer.write(new Uint8Array(bytes));
      await writer.close();
    },
    { name: key, bytes: [...PNG] },
  );
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page.locator("[data-preview-missing]").count();
      },
      { timeout: 30000 },
    )
    .toBe(0);
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  }, key);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return missingHint.count();
      },
      { timeout: 30000 },
    )
    .toBe(1);
});
