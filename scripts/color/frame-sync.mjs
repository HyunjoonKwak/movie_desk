import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
// Non-preserved framebuffer lifetime: old delayed Canvas2D sampling vs current PBO reader.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const server = createServer((_, res) =>
  res.end("<!doctype html><title>Scope frame lifetime</title>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const compile = (name) =>
    ts.transpileModule(
      readFileSync(new URL(`../../apps/web/src/scopes/${name}.ts`, import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
  const result = await page.evaluate(
    async ({ compute, readback }) => {
      const arithmetic = {};
      new Function("exports", compute)(arithmetic);
      const exports = {};
      new Function("exports", "require", readback)(exports, () => arithmetic);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 144;
      document.body.append(canvas);
      const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
      const reader = new exports.ScopeReadback(gl);
      const sample = document.createElement("canvas");
      sample.width = 240;
      sample.height = 135;
      const ctx = sample.getContext("2d", { willReadFrequently: true });
      const rows = [];
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const at = performance.now();
        const captured = new Promise((resolve, reject) =>
          reader.capture(resolve, () => reject(new Error("PBO failed"))),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        ctx.drawImage(canvas, 0, 0, 240, 135);
        const old = ctx.getImageData(0, 0, 1, 1).data;
        const current = await captured;
        rows.push({
          oldDelayMs: performance.now() - at,
          oldRgb: Array.from(old.slice(0, 3)),
          currentRgb: Array.from(current.pixels.slice(0, 3)),
          expectedRgb: [255, 255, 255],
        });
      }
      reader.dispose();
      return {
        rows,
        note: "Five paused white frames on a visible preserveDrawingBuffer:false canvas. Old 100ms+rAF drawImage schedule vs repository ScopeReadback captured immediately; no editor decode timing claim.",
      };
    },
    { compute: compile("compute"), readback: compile("readback") },
  );
  writeFileSync(
    new URL("../../docs/evaluations/2026-09-07-color-scopes-frame-sync.json", import.meta.url),
    `${JSON.stringify(result, null, 2)}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
