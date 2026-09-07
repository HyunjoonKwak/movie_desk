// Offline Chromium benchmark: old main-thread meter versus actual mixer worker.
// Run from the repository root: node scripts/audio-cleanup-benchmark.mjs
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const vite = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = vite("esbuild");
const bundle = async (entry) =>
  (
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "bench",
      platform: "browser",
    })
  ).outputFiles[0].text;
const meterCode = await bundle("packages/core/src/audio-routing/meter.ts");
const workerCode = await bundle("apps/web/src/export/audio-mixer-worker.ts");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: meterCode });
  const results = await page.evaluate(async (workerCode) => {
    const rows = [];
    const worker = new Worker(
      URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" })),
    );
    for (const seconds of [60, 600]) {
      for (let trial = 0; trial < 3; trial++) {
        const n = seconds * 48000;
        const channels = [0, 1].map((p) =>
          Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin(i * 0.7 + p)),
        );
        let start = performance.now();
        const meter = new bench.TruePeakMeter(2);
        meter.push(channels);
        const baselinePeaks = meter.finish();
        const beforeMainMs = performance.now() - start;
        let state;
        let afterMainMs = 0;
        let peaks;
        let maxTickGapMs = 0;
        let tick = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          maxTickGapMs = Math.max(maxTickGapMs, now - tick);
          tick = now;
        }, 5);
        start = performance.now();
        for (let at = 0; at < n; at += 30 * 48000) {
          const count = Math.min(30 * 48000, n - at);
          const voiceChannels = channels.map((c) => c.slice(at, at + count));
          const musicChannels = channels.map(() => new Float32Array(count));
          const result = await new Promise((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timeout);
              worker.onmessage = null;
              worker.onerror = null;
            };
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error("Mixer worker timed out after 30 seconds"));
            }, 30_000);
            worker.onerror = (event) => {
              cleanup();
              reject(new Error(event.message || "Mixer worker failed"));
            };
            worker.onmessage = (e) => {
              cleanup();
              resolve(e.data);
            };
            worker.postMessage(
              {
                voiceChannels,
                musicChannels,
                sampleRate: 48000,
                encoder: {
                  masterGain: 1,
                  final: at + count === n,
                  ...(state ? { peakState: state } : {}),
                },
              },
              [...voiceChannels, ...musicChannels].map((c) => c.buffer),
            );
          });
          const mainStart = performance.now();
          state = result.peakState;
          peaks = result.audioPeaks;
          afterMainMs += performance.now() - mainStart;
        }
        const afterWorkerWallMs = performance.now() - start;
        clearInterval(timer);
        if (JSON.stringify(peaks) !== JSON.stringify(baselinePeaks))
          throw new Error("Peak mismatch");
        rows.push({
          seconds,
          trial,
          beforeMainMs,
          afterMainMs,
          afterWorkerWallMs,
          maxTickGapMs,
          peaks,
        });
      }
    }
    worker.terminate();
    return rows;
  }, workerCode);
  process.stdout.write(`${JSON.stringify({ browser: browser.version(), results }, null, 2)}\n`);
} finally {
  await browser.close();
}
