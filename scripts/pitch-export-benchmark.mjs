import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// Audio export stage benchmark: decoded 10-minute stereo, 20 × 30s chunks.
// Run from the repository root; optional baseline Git ref (default 27128d1; --varispeed for legacy audio probes).
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const vitestRequire = createRequire(require.resolve("vitest"));
const viteRequire = createRequire(vitestRequire.resolve("vite"));
const { build } = viteRequire("esbuild");
const root = process.cwd();
const legacy = process.argv[2] === "--varispeed";
const baseline = process.argv[2] ?? "27128d1";
if (!legacy) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${baseline}^{commit}`], { stdio: "ignore" });
  } catch {
    throw new Error(
      `Unknown baseline Git ref: ${baseline}. Pass an available ancestor commit (default 27128d1).`,
    );
  }
}
const browser = await chromium.launch({ headless: true });
try {
  if (legacy) {
    const page = await browser.newPage();
    process.stdout.write(
      JSON.stringify(
        await page.evaluate(async () => {
          const sr = 48000;
          const n = sr * 2;
          const frequency = (a) => {
            let crossings = 0;
            for (let i = sr / 10 + 1; i < a.length - sr / 10; i++)
              if (a[i - 1] <= 0 && a[i] > 0) crossings++;
            return crossings / ((a.length - sr / 5) / sr);
          };
          const rows = [];
          for (const rate of [0.5, 2]) {
            const ctx = new OfflineAudioContext(1, n / rate, sr);
            const b = ctx.createBuffer(1, n, sr);
            const pcm = b.getChannelData(0);
            for (let i = 0; i < n; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
            const s = ctx.createBufferSource();
            s.buffer = b;
            s.playbackRate.value = rate;
            s.connect(ctx.destination);
            s.start();
            const out = (await ctx.startRendering()).getChannelData(0);
            const nearest = Float32Array.from(
              { length: n / rate },
              (_, i) => pcm[Math.floor(i * rate)] ?? 0,
            );
            rows.push({ rate, previewHz: frequency(out), exportHz: frequency(nearest) });
          }
          const ctx = new OfflineAudioContext(1, sr * 2, sr);
          const b = ctx.createBuffer(1, sr * 4, sr);
          for (let i = 0; i < b.length; i++)
            b.getChannelData(0)[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
          const s = ctx.createBufferSource();
          s.buffer = b;
          s.playbackRate.setValueCurveAtTime(new Float32Array([0.5, 2]), 0, 2);
          s.connect(ctx.destination);
          s.start();
          const a = (await ctx.startRendering()).getChannelData(0);
          const fixtures = [];
          for (const name of ["speech-band burst", "18kHz alias probe"]) {
            const src = new Float32Array(sr);
            for (let i = 0; i < sr; i++) {
              if (name === "18kHz alias probe") src[i] = Math.sin((2 * Math.PI * 18000 * i) / sr);
              else if (i >= sr * 0.2 && i < sr * 0.4) {
                for (let j = 0; j < 64; j++)
                  src[i] += Math.sin((2 * Math.PI * (300 + j * 49) * i) / sr + j * j * 0.71) / 8;
              }
            }
            const pcm = Float32Array.from({ length: sr / 2 }, (_, i) => src[i * 2]);
            const ctx = new OfflineAudioContext(1, sr / 2, sr);
            const b = ctx.createBuffer(1, sr, sr);
            b.copyToChannel(src, 0);
            const node = ctx.createBufferSource();
            node.buffer = b;
            node.playbackRate.value = 2;
            node.connect(ctx.destination);
            node.start();
            const preview = (await ctx.startRendering()).getChannelData(0);
            const metric = (out) => {
              let energy = 0;
              let crossings = 0;
              let re = 0;
              let im = 0;
              for (let i = 0; i < out.length; i++) {
                energy += out[i] * out[i];
                if (i && out[i - 1] <= 0 && out[i] > 0) crossings++;
                re += out[i] * Math.cos((2 * Math.PI * 12000 * i) / sr);
                im += out[i] * Math.sin((2 * Math.PI * 12000 * i) / sr);
              }
              return {
                rms: Math.sqrt(energy / out.length),
                crossings,
                alias12kAmplitude: (2 * Math.hypot(re, im)) / out.length,
              };
            };
            fixtures.push({ name, preview: metric(preview), export: metric(pcm) });
          }
          return {
            rows,
            fixtures,
            rampFirstHz: frequency(a.subarray(0, sr / 2)),
            rampLastHz: frequency(a.subarray(sr * 1.5)),
            note: "zero-crossing windows exclude 100ms each edge",
          };
        }),
        null,
        2,
      ),
    );
    await page.close();
  } else
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
