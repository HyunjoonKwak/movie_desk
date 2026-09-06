import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// Audio export stage benchmark: decoded 10-minute stereo, 20 × 30s chunks.
// Run from the repository root; optional baseline Git ref (default bf5ce34).
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const vitestRequire = createRequire(require.resolve("vitest"));
const viteRequire = createRequire(vitestRequire.resolve("vite"));
const { build } = viteRequire("esbuild");
const root = process.cwd();
const baseline = process.argv[2] ?? "bf5ce34";
const browser = await chromium.launch({ headless: true });
try {
  for (const ref of [baseline, "working-tree"]) {
    const plugin = {
      name: "benchmark-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@movie-desk\/core$/ }, () => ({
          path: resolve("packages/core/src/index.ts"),
        }));
        builder.onResolve({ filter: /^@\// }, ({ path }) => ({
          path: resolve(`apps/web/src/${path.slice(2)}.ts`),
        }));
        builder.onLoad({ filter: /\.ts$/ }, ({ path }) => {
          if (path.endsWith("/media/audio/audio-variant.ts"))
            return {
              contents: "export const audioBlobFor = async () => new Blob(['fixture']);",
              loader: "ts",
            };
          let contents =
            ref === "working-tree"
              ? readFileSync(path, "utf8")
              : execFileSync("git", ["show", `${ref}:${relative(root, path)}`], {
                  encoding: "utf8",
                });
          contents = contents
            .replace('new URL("./pitch-worker.ts", import.meta.url)', "globalThis.pitchWorkerUrl")
            .replace(
              'new URL("./audio-mixer-worker.ts", import.meta.url)',
              "globalThis.mixWorkerUrl",
            );
          return { contents, loader: "ts" };
        });
      },
    };
    const bundle = async (entry) =>
      (
        await build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: "iife",
          globalName: "Bench",
          plugins: [plugin],
          logLevel: "silent",
        })
      ).outputFiles[0].text;
    const [pitch, mix, main] = await Promise.all([
      bundle("apps/web/src/audio/pitch-worker.ts"),
      bundle("apps/web/src/export/audio-mixer-worker.ts"),
      bundle("apps/web/src/export/audio-mixer.ts"),
    ]);
    const page = await browser.newPage();
    await page.addScriptTag({ content: main });
    const result = await page.evaluate(
      async ({ pitch, mix }) => {
        globalThis.pitchWorkerUrl = URL.createObjectURL(
          new Blob([pitch], { type: "application/javascript" }),
        );
        globalThis.mixWorkerUrl = URL.createObjectURL(
          new Blob([mix], { type: "application/javascript" }),
        );
        const sr = 48000;
        const channels = [
          Float32Array.from(
            { length: sr * 600 },
            (_, i) => Math.sin((i * 2 * Math.PI * 440) / sr) * 0.25,
          ),
        ];
        channels.push(channels[0].slice());
        globalThis.OfflineAudioContext = class {
          async decodeAudioData() {
            return { sampleRate: sr, numberOfChannels: 2, getChannelData: (c) => channels[c] };
          }
        };
        let transferredBytes = 0;
        const nativePost = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, transfer) {
          if (message.clip)
            transferredBytes += message.channels.reduce((n, c) => n + c.byteLength, 0);
          return nativePost.call(this, message, transfer);
        };
        const clip = {
          id: "c",
          assetId: "a",
          kind: "media",
          start: 0,
          duration: 600000,
          trimIn: 0,
          trimOut: 600000,
          speed: 1,
          preservePitch: true,
          effects: [],
          keyframes: [],
        };
        const mixer = new Bench.ProjectAudioMixer(
          { timeline: { duration: 600000, tracks: [{ kind: "audio", clips: [clip] }] } },
          () => ({ id: "a", kind: "audio" }),
        );
        const start = performance.now();
        let chunks = 0;
        for await (const _chunk of mixer.chunks()) chunks++;
        const elapsedMs = performance.now() - start;
        mixer.dispose();
        return {
          elapsedMs,
          chunks,
          transferredBytes,
          assetBytes: channels[0].byteLength * 2,
          pitchFallback: mixer.pitchFallback ?? false,
        };
      },
      { pitch, mix },
    );
    process.stdout.write(`${JSON.stringify({ ref, ...result })}\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
