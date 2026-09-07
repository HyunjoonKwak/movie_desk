import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { configurePage, importMediaFiles, mediaCard } from "./support";

const capturePresentation = async (page: Page) => {
  await page.addInitScript(() => {
    const read = WebGL2RenderingContext.prototype.readPixels;
    WebGL2RenderingContext.prototype.readPixels = function (
      this: WebGL2RenderingContext,
      ...args: Parameters<typeof read>
    ) {
      read.apply(this, args);
      const destination = args[6];
      if (args[2] === 1920 && args[3] === 1080 && destination instanceof Uint8Array) {
        (window as unknown as { __exportPixel: number }).__exportPixel =
          destination[(540 * 1920 + 960) * 4]!;
      }
    } as typeof read;
    const original = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      original.apply(this, args);
      if (
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.hasAttribute("data-preview-canvas") &&
        this.getParameter(this.DRAW_FRAMEBUFFER_BINDING) === null
      ) {
        const pixel = new Uint8Array(4);
        this.readPixels(
          Math.floor(this.drawingBufferWidth / 2),
          Math.floor(this.drawingBufferHeight / 2),
          1,
          1,
          this.RGBA,
          this.UNSIGNED_BYTE,
          pixel,
        );
        this.canvas.dataset.colorCode = String(pixel[0]);
      }
    };
  });
};

// Capture at the actual presentation draw, before a non-preserved framebuffer
// can be discarded. The hook reads only one pixel and never changes bindings.
test("LUT space survives undo and matches BT.709 export pixels", async ({ page }) => {
  test.setTimeout(180_000);
  await configurePage(page);
  await capturePresentation(page);
  await page.goto("/editor");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(118,118,118)";
    ctx.fillRect(0, 0, 256, 144);
    return canvas.toDataURL().split(",")[1]!;
  });
  await importMediaFiles(page, {
    name: "linear-gray.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await mediaCard(page, "linear-gray.png").click();
  await page.keyboard.press("e");
  await page.locator("[data-clip]").first().click();
  const preview = page.locator("[data-preview-canvas]");
  await expect(preview).toHaveAttribute("data-color-code", "118");
  await page.locator("summary").filter({ hasText: "Add" }).click();
  await page.getByRole("button", { name: "LUT (.cube)", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Add" }).click();
  const lut = page
    .locator("li")
    .filter({ has: page.getByRole("checkbox", { name: "LUT (.cube)", exact: true }) });
  await lut.locator('input[type="file"]').setInputFiles({
    name: "quarter.cube",
    mimeType: "text/plain",
    buffer: Buffer.from("LUT_1D_SIZE 2\n0 0 0\n0.25 0.25 0.25\n"),
  });
  const space = page.getByLabel("LUT input / output space");
  await expect(space).toHaveValue("srgb");
  await expect(preview).toHaveAttribute("data-color-code", "30");
  await space.selectOption("linear");
  await expect(preview).toHaveAttribute("data-color-code", "60");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(space).toHaveValue("srgb");
  await space.selectOption("linear");
  // A short duration keeps the real encoder/export journey bounded.
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __cutStore: {
          getState(): {
            project: {
              timeline: {
                tracks: {
                  clips: { id: string; duration: number; effects: { type: string }[] }[];
                }[];
                duration: number;
              };
            };
          };
          setState(value: unknown): void;
        };
      }
    ).__cutStore;
    const project = store.getState().project;
    const graded = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.effects.some((fx) => fx.type === "lut"))!;
    store.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          playhead: 0,
          duration: 200,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips
              .filter((clip) => clip.id === graded.id)
              .map((clip) => ({ ...clip, start: 0, duration: 200 })),
          })),
        },
      },
    });
  });
  await expect(preview).toHaveAttribute("data-color-code", "60");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Family message 720p").uncheck();
  await dialog.getByLabel("Web (VP9 · MP4)").check();
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  const bytes = await readFile((await download.path())!);
  const colr = bytes.indexOf("colr");
  expect(colr).toBeGreaterThan(0);
  expect([
    bytes.readUInt16BE(colr + 8),
    bytes.readUInt16BE(colr + 10),
    bytes.readUInt16BE(colr + 12),
  ]).toEqual([1, 1, 1]);
  expect(
    await page.evaluate(() => (window as unknown as { __exportPixel: number }).__exportPixel),
  ).toBe(60);
  const require = createRequire(import.meta.url);
  await page.addScriptTag({
    path: resolve(dirname(require.resolve("mediabunny")), "../bundles/mediabunny.cjs"),
  });
  const decoded = await page.evaluate(async (base64) => {
    const library = (
      window as unknown as {
        Mediabunny: {
          Input: new (
            options: unknown,
          ) => { getPrimaryVideoTrack(): Promise<unknown>; dispose(): void };
          BufferSource: new (data: Uint8Array) => unknown;
          ALL_FORMATS: unknown;
          VideoSampleSink: new (
            track: unknown,
          ) => {
            getSample(time: number): Promise<{ toVideoFrame(): VideoFrame; close(): void } | null>;
          };
        };
      }
    ).Mediabunny;
    const input = new library.Input({
      source: new library.BufferSource(Uint8Array.from(atob(base64), (x) => x.charCodeAt(0))),
      formats: library.ALL_FORMATS,
    });
    try {
      const track = await input.getPrimaryVideoTrack();
      const sample = await new library.VideoSampleSink(track).getSample(0);
      if (!sample) throw new Error("No decoded export sample");
      const frame = sample.toVideoFrame();
      try {
        const data = new Uint8Array(frame.allocationSize());
        const planes = await frame.copyTo(data);
        return {
          color: frame.colorSpace.toJSON(),
          format: frame.format,
          y: data[
            planes[0]!.offset +
              Math.floor(frame.codedHeight / 2) * planes[0]!.stride +
              Math.floor(frame.codedWidth / 2)
          ]!,
        };
      } finally {
        frame.close();
        sample.close();
      }
    } finally {
      input.dispose();
    }
  }, bytes.toString("base64"));
  expect(decoded.format).toBe("I420");
  expect(decoded.color).toEqual({
    primaries: "bt709",
    transfer: "bt709",
    matrix: "bt709",
    fullRange: false,
  });
  // sRGB preview 60 maps to limited BT.709 Y=52; compare signal encodings explicitly.
  expect(Math.abs(decoded.y - 52)).toBeLessThanOrEqual(2);
});

// The heavyweight scripts/color/managed.mjs audit is a manual GPU audit, not
// an E2E dependency: it launches another browser and requires float precision.
for (const forceSrgb8 of [false, true]) {
  test(`context restoration recreates color targets and reports approximation state (${forceSrgb8 ? "srgb8 fallback" : "available precision"})`, async ({
    page,
  }, testInfo) => {
    await configurePage(page);
    await capturePresentation(page);
    const diagnostics: string[] = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) diagnostics.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.push(error.stack ?? error.message));
    await page.addInitScript((forceSrgb8) => {
      const prototype = WebGL2RenderingContext.prototype;
      const getExtension = prototype.getExtension;
      prototype.getExtension = function (name) {
        return forceSrgb8 && name === "EXT_color_buffer_float"
          ? null
          : getExtension.call(this, name);
      };
      // Observe actual allocations, not capability advertisement or 2x2 probes.
      // These data attributes belong to the test hook, not the product API.
      const texImage2D = prototype.texImage2D;
      prototype.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
        Reflect.apply(texImage2D, this, args);
        if (
          this.canvas instanceof HTMLCanvasElement &&
          this.canvas.hasAttribute("data-preview-canvas") &&
          args.length === 9 &&
          Number(args[3]) > 2 &&
          Number(args[4]) > 2 &&
          (args[2] === this.RGBA16F || args[2] === this.SRGB8_ALPHA8)
        ) {
          this.canvas.dataset.colorTargetPrecision =
            args[2] === this.RGBA16F ? "half-float" : "srgb8";
          this.canvas.dataset.colorTargetAllocations = String(
            Number(this.canvas.dataset.colorTargetAllocations ?? 0) + 1,
          );
        }
      } as typeof texImage2D;
      window.addEventListener("color-processing-warning", (event) => {
        const code = (event as CustomEvent<{ code: string }>).detail.code;
        document.documentElement.dataset.colorWarnings = [
          document.documentElement.dataset.colorWarnings,
          code,
        ]
          .filter(Boolean)
          .join(",");
      });
    }, forceSrgb8);
    let failed = false;
    try {
      await page.goto("/editor");
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 144;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "rgb(118,118,118)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL().split(",")[1]!;
      });
      await importMediaFiles(page, {
        name: "restore.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
      await mediaCard(page, "restore.png").click();
      await page.keyboard.press("e");
      await page.locator("[data-clip]").first().click();
      await page.locator("summary").filter({ hasText: "Add" }).click();
      await page.getByRole("button", { name: "Invert", exact: true }).click();
      const preview = page.locator("[data-preview-canvas]");
      const assertManagedFrame = async () => {
        await expect(preview).toHaveAttribute(
          "data-color-target-precision",
          forceSrgb8 ? "srgb8" : /^(half-float|srgb8)$/,
        );
        const precision = await preview.getAttribute("data-color-target-precision");
        // Encoded inversion is 255 - 118. SRGB8 round trips quantize intermediate
        // values; permit one code of error only on the reduced-precision path.
        await expect
          .poll(async () => Math.abs(Number(await preview.getAttribute("data-color-code")) - 137))
          .toBeLessThanOrEqual(precision === "srgb8" ? 1 : 0);
        const warnings =
          (await page.locator("html").getAttribute("data-color-warnings"))?.split(",") ?? [];
        expect(warnings).not.toContain("unsupported");
        if (precision === "srgb8") {
          await expect(page.getByTestId("color-processing-hint")).toContainText(
            "reduced color precision",
          );
          expect(warnings).toContain("precision");
        } else {
          expect(warnings).not.toContain("precision");
          await expect(page.getByTestId("color-processing-hint")).toHaveCount(0);
        }
      };
      await assertManagedFrame();
      const allocations = Number(await preview.getAttribute("data-color-target-allocations"));
      expect(allocations).toBeGreaterThan(0);
      // Dismiss any old precision notice so restoration must report it again.
      const hint = page.getByTestId("color-processing-hint");
      if (await hint.count()) await hint.getByRole("button").click();
      await preview.evaluate(async (element) => {
        const canvas = element as HTMLCanvasElement;
        const gl = canvas.getContext("webgl2")!;
        const extension = gl.getExtension("WEBGL_lose_context");
        if (!extension) throw new Error("WEBGL_lose_context unavailable");
        await new Promise<void>((resolve) => {
          element.addEventListener(
            "webglcontextrestored",
            () => {
              canvas.dataset.colorRestored = "true";
              resolve();
            },
            { once: true },
          );
          element.addEventListener(
            "webglcontextlost",
            () => {
              canvas.dataset.colorCode = "lost";
              delete canvas.dataset.colorTargetPrecision;
              document.documentElement.dataset.colorWarnings = "";
              setTimeout(() => extension.restoreContext(), 50);
            },
            { once: true },
          );
          extension.loseContext();
        });
      });
      await expect(preview).toHaveAttribute("data-color-restored", "true");
      await assertManagedFrame();
      expect(Number(await preview.getAttribute("data-color-target-allocations"))).toBeGreaterThan(
        allocations,
      );
      expect(
        await preview.evaluate((element) =>
          (element as HTMLCanvasElement).getContext("webgl2")!.isContextLost(),
        ),
      ).toBe(false);
      // Keep the separate source-approximation notice contract explicit.
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("color-processing-warning", {
            detail: { code: "approximation", name: "fallback.mov" },
          }),
        ),
      );
      await expect(hint).toContainText("fallback.mov");
      await expect(hint).toContainText("browser’s SDR approximation");
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const state = await page
        .locator("[data-preview-canvas]")
        .evaluateAll((elements) =>
          elements.map((element) => ({ ...(element as HTMLCanvasElement).dataset })),
        )
        .catch(() => []);
      const report = JSON.stringify({ forceSrgb8, state, diagnostics }, null, 2);
      await testInfo.attach("color-context-diagnostics", {
        body: report,
        contentType: "application/json",
      });
      // biome-ignore lint/suspicious/noConsole: CI must show GPU diagnostics without opening attachments.
      if (failed) console.error(report);
    }
  });
}
