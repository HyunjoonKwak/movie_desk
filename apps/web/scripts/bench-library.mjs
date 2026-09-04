#!/usr/bin/env node
// Library scale benchmark (work order A5). Drives the running dev server with
// the installed Google Chrome, imports a mixed library and measures what a
// user feels: import throughput, search latency, the source-health pass,
// the persisted project size, reload-to-ready and JS heap.
//
//   pnpm --filter @movie-desk/web dev            # in another terminal
//   node apps/web/scripts/bench-library.mjs [--assets 1000] [--videos 200] [--out result.json]
//
// Numbers land in the console as a markdown table (and JSON with --out).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(resolve(here, "../node_modules/@playwright/test/index.mjs"));

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const positive = (name, fallback) => {
  const value = Number(arg(name, fallback));
  if (!Number.isInteger(value) || value < 0) {
    console.error(`--${name} must be a non-negative integer`);
    process.exit(2);
  }
  return value;
};
const TOTAL = positive("assets", "1000");
const VIDEOS = Math.min(positive("videos", "200"), TOTAL);
const OUT = arg("out", null);
const BASE = arg("url", "http://127.0.0.1:3000");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const MP4 = readFileSync(join(here, "../src/media/__tests__/fixtures/aac-video.mp4"));

const files = Array.from({ length: TOTAL }, (_, i) =>
  i < VIDEOS
    ? { name: `clip-${String(i).padStart(4, "0")}.mp4`, mimeType: "video/mp4", buffer: MP4 }
    : { name: `photo-${String(i).padStart(4, "0")}.png`, mimeType: "image/png", buffer: PNG },
);

const ms = (n) => `${Math.round(n)} ms`;
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// Waits for `read()` to reach `target`, failing instead of hanging.
const untilAtLeast = async (read, target, timeoutMs) => {
  const start = performance.now();
  while ((await read()) < target) {
    if (performance.now() - start > timeoutMs) throw new Error(`timed out waiting for ${target}`);
    await page.waitForTimeout(250);
  }
};

// A fresh, ephemeral browser context: never the user's Chrome profile.
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
  localStorage.setItem("cut.persistence.welcomed", "1");
  // Count OPFS file opens: one per source-health probe, thumbnail read, etc.
  const stats = { fileOpens: 0 };
  window.__bench = stats;
  const proto = FileSystemFileHandle.prototype;
  const getFile = proto.getFile;
  proto.getFile = function (...args) {
    stats.fileOpens += 1;
    return getFile.apply(this, args);
  };
});

const cardCount = () => page.locator("[data-asset-card]").count();
const heap = () =>
  page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
const libraryRowBytes = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("cut_editor.library.v1");
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("projects").objectStore("projects").getAll();
          req.onsuccess = () => {
            db.close();
            resolve(Math.max(0, ...req.result.map((row) => row.json.length)));
          };
        };
        open.onerror = () => resolve(-1);
      }),
  );
const untilStable = async (read, { settleMs = 1500, timeoutMs = 600_000 } = {}) => {
  const start = performance.now();
  let last = await read();
  let lastChange = performance.now();
  while (performance.now() - start < timeoutMs) {
    await page.waitForTimeout(250);
    const next = await read();
    if (next !== last) {
      last = next;
      lastChange = performance.now();
    } else if (performance.now() - lastChange >= settleMs) break;
  }
  return { value: last, elapsed: lastChange - start };
};

const result = { assets: TOTAL, videos: VIDEOS };
try {
  await page.goto(`${BASE}/editor`);
  const startInput = page.getByTestId("new-project-start").getByTestId("media-file-input");
  await startInput.waitFor({ state: "attached" });

  // 1. Import throughput.
  let t0 = performance.now();
  await startInput.setInputFiles(files);
  await page.locator("[data-asset-card]").first().waitFor({ timeout: 120_000 });
  await untilAtLeast(cardCount, TOTAL, Math.max(120_000, TOTAL * 200));
  result.importMs = performance.now() - t0;
  result.importPerAssetMs = result.importMs / TOTAL;
  await page.waitForTimeout(2_000);
  result.heapAfterImport = await heap();
  result.fileOpensDuringImport = await page.evaluate(() => window.__bench.fileOpens);

  // 2. Persisted project size (the debounced library row holds the whole project).
  await page.waitForTimeout(1_000);
  result.libraryRowBytes = await libraryRowBytes();

  // 3. Search latency: type a query, wait for the match count to update.
  const search = page.getByPlaceholder("Search media…");
  await page.getByRole("button", { name: "Filters" }).click();
  const count = page.getByTestId("media-match-count");
  t0 = performance.now();
  await search.fill("clip-01");
  await count.filter({ hasText: /^\d+ of \d+$/ }).waitFor();
  await page.waitForFunction(
    (n) =>
      !document
        .querySelector('[data-testid="media-match-count"]')
        ?.textContent?.startsWith(`${n} of`),
    TOTAL,
  );
  result.searchMs = performance.now() - t0;
  await search.fill("");
  t0 = performance.now();
  await page.getByLabel("Length").selectOption("short"); // videos only; images have no length
  await page.waitForFunction(
    (n) =>
      !document
        .querySelector('[data-testid="media-match-count"]')
        ?.textContent?.startsWith(`${n} of`),
    TOTAL,
  );
  result.filterMs = performance.now() - t0;
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  // 4. Source-health pass on window focus: every asset opens its OPFS file once.
  await page.waitForTimeout(11_000); // past the forced-pass throttle
  const opensBefore = await page.evaluate(() => window.__bench.fileOpens);
  t0 = performance.now();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const probe = await untilStable(() => page.evaluate(() => window.__bench.fileOpens), {
    settleMs: 1_000,
  });
  result.healthPassMs = probe.elapsed;
  result.healthPassOpens = probe.value - opensBefore;

  // 5. Reload → library restored (row parse + Yjs sync) → all cards back.
  t0 = performance.now();
  await page.reload();
  await untilAtLeast(cardCount, TOTAL, 120_000);
  result.reloadToReadyMs = performance.now() - t0;
  result.heapAfterReload = await heap();

  // 6. Single edit cost with a large library: rename the project and wait for the save badge.
  t0 = performance.now();
  const nameInput = page.locator('header input[type="text"]').first();
  await nameInput.fill("bench");
  await nameInput.press("Enter");
  await page.getByText(/^Saved/).waitFor();
  result.renameToSavedMs = performance.now() - t0;
} finally {
  await browser.close();
}

const rows = [
  ["assets", `${TOTAL} (${VIDEOS} video, ${TOTAL - VIDEOS} image)`],
  ["import total", `${ms(result.importMs)} (${result.importPerAssetMs.toFixed(1)} ms/asset)`],
  ["OPFS file opens during import", String(result.fileOpensDuringImport)],
  ["JS heap after import", result.heapAfterImport ? mb(result.heapAfterImport) : "n/a"],
  ["persisted project JSON", mb(result.libraryRowBytes)],
  ["search keystroke → count", ms(result.searchMs)],
  ["filter change → count", ms(result.filterMs)],
  [
    "source-health pass (focus)",
    `${ms(result.healthPassMs)} (${result.healthPassOpens} file opens)`,
  ],
  ["reload → all cards", ms(result.reloadToReadyMs)],
  ["JS heap after reload", result.heapAfterReload ? mb(result.heapAfterReload) : "n/a"],
  ["rename → Saved badge", ms(result.renameToSavedMs)],
];
console.log("| metric | value |\n| --- | --- |");
for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
