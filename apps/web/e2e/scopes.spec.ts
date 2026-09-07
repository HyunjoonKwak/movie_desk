import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { configurePage, importMediaFiles, mediaCard } from "./support";
test("scopes show sampled values in every mode and at 390px", async ({ page }) => {
  await configurePage(page);
  await page.goto("/editor");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 256, 144);
    ctx.fillStyle = "white";
    ctx.fillRect(128, 0, 128, 144);
    return canvas.toDataURL().split(",")[1]!;
  });
  await importMediaFiles(page, {
    name: "scope-patches.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await mediaCard(page, "scope-patches.png").click();
  await page.keyboard.press("e");
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  const measure = async () => {
    await page.getByRole("button", { name: "Go to start", exact: true }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const result = await page.evaluate(async () => {
      const preview = document.querySelector<HTMLCanvasElement>("[data-preview-canvas]")!;
      // Keep CSS stable so ResizeObserver does not replace the requested native resolution.
      const owner = preview.parentElement!;
      owner.style.borderWidth = "0px";
      owner.style.flexShrink = "0";
      owner.style.width = "1920px";
      owner.style.height = "1080px";
      owner.style.maxWidth = "none";
      owner.style.maxHeight = "none";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      preview.width = 1920;
      preview.height = 1080;
      const intervals: number[] = [];
      const captures: number[] = [];
      const workers: number[] = [];
      const paints: number[] = [];
      const scope = document.querySelector<HTMLCanvasElement>("[data-testid=scopes-panel] canvas");
      const observer = new MutationObserver(() => {
        if (scope) {
          captures.push(Number(scope.dataset.captureMs));
          workers.push(Number(scope.dataset.workerMs));
          paints.push(Number(scope.dataset.paintMs));
        }
      });
      if (scope) observer.observe(scope, { attributes: true });
      let previous = 0;
      for (let i = 0; i < 130; i++) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        if (i > 10) intervals.push(now - previous);
        previous = now;
      }
      observer.disconnect();
      const summary = (xs: number[]) => {
        xs.sort((a, b) => a - b);
        return {
          count: xs.length,
          p50: xs[Math.floor(xs.length * 0.5)] ?? null,
          p95: xs[Math.floor(xs.length * 0.95)] ?? null,
          max: xs.at(-1) ?? null,
        };
      };
      return {
        width: preview.width,
        height: preview.height,
        frameIntervalMs: summary(intervals),
        captureMainMs: summary(captures),
        workerMs: summary(workers),
        paintMainMs: summary(paints),
      };
    });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.locator("[data-preview-canvas]").evaluate((canvas) => {
      const owner = canvas.parentElement!;
      owner.style.borderWidth = "";
      owner.style.flexShrink = "";
      owner.style.width = "";
      owner.style.height = "";
      owner.style.maxWidth = "";
      owner.style.maxHeight = "";
    });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    return result;
  };
  const baseline = process.env.COLOR_AUDIT ? await measure() : null;
  await page.getByRole("button", { name: "Scopes", exact: true }).click();
  const panel = page.getByTestId("scopes-panel");
  await expect(panel.getByTestId("scope-values")).toContainText(/Samples: [1-9]/);
  if (process.env.COLOR_AUDIT) {
    const enabled = await measure();
    await writeFile(
      "../../docs/evaluations/2026-09-07-color-scopes-performance.json",
      `${JSON.stringify(
        {
          baseline,
          enabled,
          note: "1080p actual editor playback, cached still clip, 130 rAF ticks per condition; scope capture, worker and bitmap paint timings exclude React commit.",
        },
        null,
        2,
      )}\n`,
    );
  }
  await expect(panel.getByTestId("scope-values")).toContainText(/Near white ≥254: [1-9]/);
  for (const kind of ["luma", "waveform", "parade", "vectorscope"]) {
    await panel.getByRole("combobox").selectOption(kind);
    await expect(panel.getByTestId("scope-values")).toContainText(/Samples: [1-9]/);
  }
  // A transient readback failure retries once without a mode change.
  await page.evaluate(() => window.dispatchEvent(new Event("scopes-error")));
  await expect(panel.getByTestId("scope-values")).toContainText(/Near white ≥254: [1-9]/);
  await expect(panel.getByTestId("scope-values")).toContainText("%");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Scopes", exact: true }).click();
  await expect(panel.getByTestId("scope-values")).toContainText(/Samples: [1-9]/);
  if (process.env.COLOR_AUDIT)
    await page.screenshot({ path: "../../docs/evaluations/2026-09-07-color-scopes-390.png" });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});
