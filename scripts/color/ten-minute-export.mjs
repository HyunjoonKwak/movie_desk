import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { chromium } = require("@playwright/test");
const root = path.resolve(import.meta.dirname, "../..");
const stubs = new Set([
  "apps/web/src/export/bt709-worker-factory.ts",
  "mediabunny",
  "apps/web/src/export/audio-mixer.ts",
  "apps/web/src/export/aac-priming.ts",
  "apps/web/src/export/ducking-store.ts",
  "apps/web/src/export/normalize-store.ts",
  "apps/web/src/stores/range-store.ts",
  "apps/web/src/stores/project-store.ts",
  "apps/web/src/export/preflight.ts",

  "apps/web/src/ai/bg-remove.ts",
  "apps/web/src/effects/lut/lut-store.ts",
  "apps/web/src/media/source/resolve-media-source.ts",
  "apps/web/src/renderer/frame-source.ts",
  "apps/web/src/renderer/webcodecs-decoder.ts",
  "apps/web/src/renderer/shape-source.ts",
  "apps/web/src/renderer/text-source.ts",
  "nanoid",
]);
function modules(base) {
  const result = {};
  const visit = (file) => {
    if (result[file] || stubs.has(file)) return file;
    result[file] = "";
    const source = base
      ? execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" })
      : readFileSync(path.join(root, file), "utf8");
    let js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    js = js.replace(/require\("([^"\n]+)"\)/g, (_, id) => {
      let resolved =
        id === "@movie-desk/core"
          ? "packages/core/src/index.ts"
          : id.startsWith("@/")
            ? `apps/web/src/${id.slice(2)}`
            : id.startsWith(".")
              ? path.posix.join(path.posix.dirname(file), id)
              : id;
      if (!stubs.has(resolved) && resolved !== "nanoid" && !resolved.endsWith(".ts"))
        resolved += existsSync(path.join(root, `${resolved}.ts`)) ? ".ts" : "/index.ts";
      visit(resolved);
      return `require(${JSON.stringify(resolved)})`;
    });
    result[file] = js;
    return file;
  };
  visit("apps/web/src/export/exporter.ts");
  return result;
}
const managedOnly = process.argv.includes("--managed-only");
const neutral = process.argv.includes("--neutral");
const durationSeconds = Number(process.env.COLOR_EXPORT_SECONDS ?? 600);
const oldModules = managedOnly ? {} : modules("0e6804a");
const newModules = modules();
const compileWorkerFile = (file) =>
  ts.transpileModule(readFileSync(path.join(root, `apps/web/src/${file}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const workerBundle = `const color = {}; new Function("exports", ${JSON.stringify(compileWorkerFile("renderer/color"))})(color); const frame = {}; new Function("exports", "require", ${JSON.stringify(compileWorkerFile("export/bt709-frame"))})(frame, () => color); new Function("exports", "require", ${JSON.stringify(compileWorkerFile("export/bt709.worker"))})({}, () => frame);`;

const fixture = readFileSync(path.join(root, "apps/web/e2e/fixtures/vp9_clip.mp4"));
const server = createServer((req, res) => {
  if (req.url === "/fixture.mp4") {
    res.setHeader("Content-Type", "video/mp4");
    res.end(fixture);
  } else res.end("<!doctype html><title>Managed compositor GPU audit</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const metal = process.env.COLOR_GPU === "metal";
const browser = await chromium.launch(metal ? { args: ["--use-angle=metal"] } : {});
try {
  const page = await browser.newPage();
  await page.exposeFunction("reportProgress", (message) => process.stdout.write(`${message}\n`));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({
    path: path.resolve(path.dirname(require.resolve("mediabunny")), "../bundles/mediabunny.cjs"),
  });
  const result = await page.evaluate(
    async ({ oldModules, newModules, workerBundle, managedOnly, neutral, durationSeconds }) => {
      const workerUrl = URL.createObjectURL(new Blob([workerBundle], { type: "text/javascript" }));
      const source = document.createElement("canvas");
      source.width = 1920;
      source.height = 1080;
      const ctx = source.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
      gradient.addColorStop(0, "#286a93");
      gradient.addColorStop(1, "#ded39c");
      ctx.fillStyle = neutral ? "#000000" : gradient;
      ctx.fillRect(0, 0, 1920, 1080);
      const image = new Image();
      image.src = source.toDataURL();
      await image.decode();
      const asset = {
        id: "source",
        name: "synthetic-1080p.png",
        kind: "image",
        width: 1920,
        height: 1080,
      };
      const project = {
        id: "project",
        name: "ten-minute-color",
        resolution: { w: 1920, h: 1080 },
        mediaLibrary: [asset],
        timeline: {
          playhead: 0,
          duration: durationSeconds * 1000,
          transitions: [],
          tracks: [
            {
              id: "track",
              kind: "video",
              clips: [
                {
                  id: "clip",
                  kind: "media",
                  assetId: "source",
                  start: 0,
                  duration: durationSeconds * 1000,
                  speed: 1,
                  trimIn: 0,
                  keyframes: [],
                  effects: neutral
                    ? []
                    : [{ id: "exposure", type: "exposure", enabled: true, params: { stops: 1 } }],
                },
              ],
            },
          ],
        },
      };
      const stubModules = {
        "apps/web/src/export/bt709-worker-factory.ts": {
          createBt709Worker: () => new Worker(workerUrl),
        },
        mediabunny: window.Mediabunny,
        "apps/web/src/export/audio-mixer.ts": {},
        "apps/web/src/export/aac-priming.ts": {},
        "apps/web/src/export/ducking-store.ts": {},
        "apps/web/src/export/normalize-store.ts": {},
        "apps/web/src/stores/project-store.ts": {},
        "apps/web/src/stores/range-store.ts": {
          useRangeStore: { getState: () => ({ inMs: null, outMs: null }) },
        },
        "apps/web/src/export/preflight.ts": {
          findMissingMedia: async () => [],
          MissingMediaError: Error,
        },
        "apps/web/src/ai/bg-remove.ts": {},
        "apps/web/src/effects/lut/lut-store.ts": {
          useLutStore: { getState: () => ({ getLut: () => undefined }) },
        },
        "apps/web/src/media/source/resolve-media-source.ts": {
          resolveMediaSource: async () => null,
        },
        "apps/web/src/renderer/frame-source.ts": {
          FrameSourcePool: class {
            get() {
              return Promise.resolve(image);
            }
            retain() {}
            dispose() {}
          },
        },
        "apps/web/src/renderer/webcodecs-decoder.ts": {
          getFrameProvider: () => ({ retain() {}, has: () => true, framesFor: () => null }),
        },
        "apps/web/src/renderer/shape-source.ts": {},
        "apps/web/src/renderer/text-source.ts": {},
        nanoid: { nanoid: () => "fixture-id" },
      };
      const rows = [];
      for (const [name, modules] of managedOnly
        ? [["pipelined", newModules]]
        : [
            ["legacy", oldModules],
            ["managed", newModules],
          ]) {
        const cache = { ...stubModules };
        const get = (id) => {
          if (cache[id]) return cache[id];
          const exports = {};
          cache[id] = exports;
          new Function("exports", "require", "module", modules[id])(exports, get, { exports });
          return exports;
        };
        const { WebCodecsExporter } = get("apps/web/src/export/exporter.ts");
        const exporter = new WebCodecsExporter();
        exporter.resolveProject = async () => ({ project, getAsset: () => asset });
        const at = performance.now();
        let last = -1;
        const result = await exporter.start(
          {
            projectId: "project",
            preset: {
              id: "web-vp9-video-only",
              container: "mp4",
              videoCodec: "vp9",
              audioCodec: "opus",
              width: 1920,
              height: 1080,
              fps: 30,
              videoBitrateKbps: 6000,
              audioBitrateKbps: 128,
            },
          },
          (progress) => {
            const fraction = Math.floor(progress.progress * 10);
            if (fraction > last) {
              last = fraction;
              window.reportProgress(
                `${name}: ${Math.round(progress.progress * 100)}% ${progress.stage}`,
              );
            }
          },
        );
        const totalMs = performance.now() - at;
        window.reportProgress(`${name} encode/mux finished: ${totalMs}ms`);
        let decoded = null;
        if (neutral) {
          const library = window.Mediabunny;
          const input = new library.Input({
            source: new library.BufferSource(await result.blob.arrayBuffer()),
            formats: library.ALL_FORMATS,
          });
          try {
            const sample = await new library.VideoSampleSink(
              await input.getPrimaryVideoTrack(),
            ).getSample(0);
            if (!sample) throw new Error("Neutral output has no sample");
            const frame = sample.toVideoFrame();
            try {
              if (frame.format !== "I420")
                throw new Error(`Unexpected neutral format: ${frame.format}`);
              const data = new Uint8Array(frame.allocationSize());
              const planes = await frame.copyTo(data);
              let mismatches = 0;
              let maxError = 0;
              const histograms = [Object.create(null), Object.create(null), Object.create(null)];
              for (let p = 0; p < 3; p++) {
                const width = p ? 960 : 1920;
                const height = p ? 540 : 1080;
                const expected = p ? 128 : 16;
                for (let y = 0; y < height; y++)
                  for (let x = 0; x < width; x++) {
                    const value = data[planes[p].offset + y * planes[p].stride + x];
                    histograms[p][value] = (histograms[p][value] ?? 0) + 1;
                    maxError = Math.max(maxError, Math.abs(value - expected));
                    if (value !== expected) mismatches++;
                  }
              }
              decoded = {
                color: frame.colorSpace.toJSON(),
                format: frame.format,
                blackYuvMismatches: mismatches,
                maxError,
                histograms,
                planeSha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
                  .map((x) => x.toString(16).padStart(2, "0"))
                  .join(""),
              };
            } finally {
              frame.close();
              sample.close();
            }
          } finally {
            input.dispose();
          }
        }
        rows.push({
          ...(decoded ? { decoded } : {}),
          name,
          durationSeconds,
          frames: durationSeconds * 30,
          totalMs,
          bytes: result.blob.size,
        });
        window.reportProgress(`${name} finished: ${totalMs}ms`);
      }
      URL.revokeObjectURL(workerUrl);
      if (
        neutral &&
        rows.length === 2 &&
        (rows[0].decoded.planeSha256 !== rows[1].decoded.planeSha256 ||
          rows[0].bytes !== rows[1].bytes)
      )
        throw new Error("Neutral legacy/managed decoded pixels or encoded sizes differ");
      return {
        fixture: `1920x1080 ${neutral ? "opaque black still, no effects (same limited Y16/U128/V128 signal)" : "gradient still, +1EV"}, ${durationSeconds}s at 30fps, VP9 6Mbps, video-only`,
        scope:
          "Actual WebCodecsExporter, Compositor, encoder queue, Mp4Writer and final Blob; in-memory image source and preflight adapter, no audio or source-file I/O",
        rows,
      };
    },
    { oldModules, newModules, workerBundle, managedOnly, neutral, durationSeconds },
  );
  writeFileSync(
    path.join(
      root,
      durationSeconds !== 600
        ? "docs/evaluations/2026-09-07-color-pipeline-smoke.json"
        : neutral
          ? "docs/evaluations/2026-09-07-color-ten-minute-neutral.json"
          : metal
            ? "docs/evaluations/2026-09-07-color-ten-minute-metal.json"
            : managedOnly
              ? "docs/evaluations/2026-09-07-color-ten-minute-pipelined.json"
              : "docs/evaluations/2026-09-07-color-ten-minute-export.json",
    ),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI measurement output.
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
