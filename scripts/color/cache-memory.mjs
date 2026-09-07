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
  "apps/web/src/ai/bg-remove.ts",
  "apps/web/src/effects/lut/lut-store.ts",
  "apps/web/src/media/source/resolve-media-source.ts",
  "apps/web/src/renderer/frame-source.ts",
  "apps/web/src/renderer/webcodecs-decoder.ts",
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
      if (resolved !== "nanoid" && !resolved.endsWith(".ts"))
        resolved += existsSync(path.join(root, `${resolved}.ts`)) ? ".ts" : "/index.ts";
      visit(resolved);
      return `require(${JSON.stringify(resolved)})`;
    });
    result[file] = js;
    return file;
  };
  visit("apps/web/src/renderer/compositor.ts");
  return result;
}

// Bench default baselines must be reachable from main, never branch-only commits.
const baseline = execFileSync("git", ["rev-parse", process.argv[2] ?? "0e6804a"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const oldModules = modules(baseline);
const newModules = modules();
const server = createServer((_, res) =>
  res.end("<!doctype html><title>Color cache benchmark</title>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const rows = [];
try {
  for (const [label, implementation] of [
    ["before", oldModules],
    ["after", newModules],
  ]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    rows.push(
      await page.evaluate(
        async ({ label, implementation }) => {
          const sources = new Map();
          const luts = new Map();
          const videoFrames = new Map();
          const stubModules = {
            "apps/web/src/ai/bg-remove.ts": {
              getSegmenter: () => {
                throw new Error("No AI in fixture");
              },
            },
            "apps/web/src/effects/lut/lut-store.ts": {
              useLutStore: { getState: () => ({ getLut: (id) => luts.get(id) }) },
            },
            "apps/web/src/media/source/resolve-media-source.ts": {
              resolveMediaSource: async () => null,
            },
            "apps/web/src/renderer/frame-source.ts": {
              FrameSourcePool: class {
                get(a) {
                  return Promise.resolve(sources.get(a.id));
                }
                retain() {}
                dispose() {}
              },
            },
            "apps/web/src/renderer/webcodecs-decoder.ts": {
              getFrameProvider: () => ({
                retain() {},
                has: () => true,
                framesFor: (id) => videoFrames.get(id) ?? null,
              }),
            },
            nanoid: { nanoid: () => "fixture-id" },
          };
          function load(modules) {
            const cache = { ...stubModules };
            const get = (id) => {
              if (cache[id]) return cache[id];
              const exports = {};
              cache[id] = exports;
              new Function("exports", "require", "module", modules[id])(exports, get, { exports });
              return exports;
            };
            return {
              get,
              Compositor: get("apps/web/src/renderer/compositor.ts").Compositor,
              effects: get("apps/web/src/effects/registry.ts").listEffects(),
            };
          }

          const { Compositor } = load(implementation);
          const canvas = document.createElement("canvas");
          canvas.width = 1920;
          canvas.height = 1080;
          const compositor = new Compositor(canvas);
          const gl = canvas.getContext("webgl2");
          if (label === "after" && compositor.colorPrecision !== "half-float")
            throw new Error("This byte-accounting benchmark requires RGBA16F support");
          const extension = gl.getExtension("WEBGL_debug_renderer_info");
          const renderer = extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : "unknown";
          // Track requested WebGL texture storage, not opaque driver/process VRAM.
          const sizes = new Map();
          let resident = 0;
          let peak = 0;
          let targetAllocations = 0;
          let targetAllocatedBytes = 0;
          let textureDeletes = 0;
          const liveFramebuffers = new Set();
          let framebufferCreates = 0;
          let framebufferDeletes = 0;
          const createFramebuffer = gl.createFramebuffer.bind(gl);
          gl.createFramebuffer = () => {
            framebufferCreates++;
            const fbo = createFramebuffer();
            liveFramebuffers.add(fbo);
            return fbo;
          };
          const deleteFramebuffer = gl.deleteFramebuffer.bind(gl);
          gl.deleteFramebuffer = (fbo) => {
            framebufferDeletes++;
            liveFramebuffers.delete(fbo);
            return deleteFramebuffer(fbo);
          };
          const texImage2D = gl.texImage2D.bind(gl);
          gl.texImage2D = (...args) => {
            const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
            const source = args.at(-1);
            const width =
              args.length === 9
                ? args[3]
                : source.naturalWidth || source.displayWidth || source.width;
            const height =
              args.length === 9
                ? args[4]
                : source.naturalHeight || source.displayHeight || source.height;
            const bytes = width * height * (args[2] === gl.RGBA16F ? 8 : 4);
            if (
              args.length === 9 &&
              source === null &&
              (args[2] === gl.RGBA16F || width > 1 || height > 1)
            ) {
              targetAllocations++;
              targetAllocatedBytes += bytes;
            }
            resident += bytes - (sizes.get(texture) || 0);
            sizes.set(texture, bytes);
            peak = Math.max(peak, resident);
            return texImage2D(...args);
          };
          const deleteTexture = gl.deleteTexture.bind(gl);
          gl.deleteTexture = (texture) => {
            textureDeletes++;
            resident -= sizes.get(texture) || 0;
            sizes.delete(texture);
            return deleteTexture(texture);
          };
          const photo = document.createElement("canvas");
          photo.width = 3840;
          photo.height = 2160;
          const ctx = photo.getContext("2d");
          ctx.fillStyle = "#808080";
          ctx.fillRect(0, 0, photo.width, photo.height);
          const assets = Array.from({ length: 1000 }, (_, i) => ({
            id: `photo-${i}`,
            kind: "image",
            width: photo.width,
            height: photo.height,
          }));
          const project = {
            id: "cache-bench",
            resolution: { w: 1920, h: 1080 },
            mediaLibrary: assets,
            timeline: {
              playhead: 0,
              duration: 1000,
              transitions: [],
              tracks: [{ id: "track", kind: "video", clips: [] }],
            },
          };
          globalThis.gc?.();
          const heapBefore = performance.memory.usedJSHeapSize;
          const started = performance.now();
          for (const asset of assets) {
            const bitmap = await createImageBitmap(photo);
            sources.set(asset.id, bitmap);
            project.timeline.tracks[0].clips = [
              {
                id: "clip",
                kind: "media",
                assetId: asset.id,
                start: 0,
                duration: 1000,
                trimIn: 0,
                speed: 1,
                keyframes: [],
                effects: [],
              },
            ];
            await compositor.renderFrame(project, (id) => assets.find((a) => a.id === id));
            gl.finish();
            if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
              throw new Error("GPU failed during cache benchmark");
            sources.delete(asset.id);
            bitmap.close();
          }
          globalThis.gc?.();
          const heapAfter = performance.memory.usedJSHeapSize;
          const retainedTextureBytes = resident;
          const benchmarkPeak = peak;
          const cachedImageBytes = compositor.imageTargets?.weight ?? null;
          if (label === "after" && cachedImageBytes > Compositor.IMAGE_TARGET_BYTES)
            throw new Error("Image budget exceeded");
          const elapsedMs = performance.now() - started;
          const stress = [];
          if (label === "after") {
            for (let i = 0; i < 20; i++) {
              photo.width = i === 0 ? 6000 : 1920 + i * 128;
              photo.height = i === 0 ? 4000 : 1080 + i * 64;
              ctx.fillStyle = "#808080";
              ctx.fillRect(0, 0, photo.width, photo.height);
              const asset = assets[0];
              asset.width = photo.width;
              asset.height = photo.height;
              const input = i === 0 ? await createImageBitmap(photo) : photo;
              sources.set(asset.id, input);
              project.timeline.tracks[0].clips[0].assetId = asset.id;
              await compositor.renderFrame(project, () => asset);
              gl.finish();
              const pixel = new Uint8Array(4);
              gl.readPixels(960, 540, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              if (Math.abs(pixel[0] - 128) > 1 || pixel[3] !== 255 || gl.getError() !== gl.NO_ERROR)
                throw new Error("Oversize/resolution churn changed neutral pixels");
              if (
                compositor.imageTargets.weight > Compositor.IMAGE_TARGET_BYTES ||
                compositor.sourceTargets.weight > Compositor.SOURCE_TARGET_BYTES
              )
                throw new Error("Oversize/resolution churn exceeded budget");
              stress.push({
                width: photo.width,
                height: photo.height,
                imageBytes: compositor.imageTargets.weight,
                sourceBytes: compositor.sourceTargets.weight,
                pixel: [...pixel],
              });
              sources.delete(asset.id);
              if (input instanceof ImageBitmap) input.close();
            }
          }
          // Exercise the real text rasterizer and video upload path together.
          // Decoding is excluded: timestamped VideoFrames are supplied by the
          // provider stub, while all upload, transfer and composition is real GL.
          const workingSets = [];
          const mediaClip = (id) => ({
            id,
            kind: "media",
            assetId: id,
            start: 0,
            duration: 1000,
            trimIn: 0,
            speed: 1,
            keyframes: [],
            effects: [],
          });
          photo.width = 3840;
          photo.height = 2160;
          ctx.fillStyle = "#808080";
          ctx.fillRect(0, 0, photo.width, photo.height);
          const small = document.createElement("canvas");
          small.width = 1920;
          small.height = 1080;
          small.getContext("2d").drawImage(photo, 0, 0, 1920, 1080);
          const bigFrame = new VideoFrame(photo, { timestamp: 0 });
          const smallFrame = new VideoFrame(small, { timestamp: 0 });
          videoFrames.set("video-4k", bigFrame);
          videoFrames.set("video-1080", smallFrame);
          const oversized = document.createElement("canvas");
          oversized.width = 6000;
          oversized.height = 4000;
          oversized.getContext("2d").drawImage(photo, 0, 0, 6000, 4000);
          const oversizedFrame = new VideoFrame(oversized, { timestamp: 0 });
          videoFrames.set("video-oversized", oversizedFrame);
          const oversizedAsset = {
            id: "video-oversized",
            kind: "video",
            width: 6000,
            height: 4000,
          };
          const stills = await Promise.all([0, 1, 2].map(() => createImageBitmap(photo)));
          stills.forEach((bitmap, i) => sources.set(`still-${i}`, bitmap));
          const videoAssets = [
            { id: "video-4k", kind: "video", width: 3840, height: 2160 },
            { id: "video-1080", kind: "video", width: 1920, height: 1080 },
          ];
          const stillAssets = stills.map((_, i) => ({
            id: `still-${i}`,
            kind: "image",
            width: 3840,
            height: 2160,
          }));
          const title = {
            id: "title",
            kind: "text",
            text: "4K video + 1080p title",
            font: "sans-serif",
            size: 80,
            color: "#ffffff",
            shadow: false,
            start: 0,
            duration: 1000,
            keyframes: [],
            effects: [],
          };
          for (const [name, fixtureAssets, clips] of [
            ["4k-video-1080p-title", videoAssets, [mediaClip("video-4k"), title]],
            ["4k-video-1080p-video", videoAssets, videoAssets.map((a) => mediaClip(a.id))],
            ["three-4k-stills", stillAssets, stillAssets.map((a) => mediaClip(a.id))],
            [
              "oversized-video-1080p-title",
              [oversizedAsset],
              [mediaClip(oversizedAsset.id), title],
            ],
          ]) {
            compositor.sourceTargets?.clear();
            compositor.imageTargets?.clear();
            project.mediaLibrary = fixtureAssets;
            project.timeline.tracks = [...clips].reverse().map((clip, i) => ({
              id: `layer-${i}`,
              kind: clip.kind === "text" ? "text" : "video",
              clips: [clip],
            }));
            const render = async () => {
              await compositor.renderFrame(project, (id) => fixtureAssets.find((a) => a.id === id));
              gl.finish();
              if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
                throw new Error(`GPU failed during ${name}`);
            };
            for (let i = 0; i < 30; i++) await render();
            const centerRow = new Uint8Array(1920 * 4);
            gl.readPixels(0, 540, 1920, 1, gl.RGBA, gl.UNSIGNED_BYTE, centerRow);
            const titleVisible =
              clips.includes(title) && centerRow.some((v, i) => i % 4 === 0 && v > 200);
            if (clips.includes(title) && !titleVisible) throw new Error(`Title missing in ${name}`);
            const startAllocations = targetAllocations;
            const startBytes = targetAllocatedBytes;
            const startDeletes = textureDeletes;
            const startFboCreates = framebufferCreates;
            const startFboDeletes = framebufferDeletes;
            const batches = [];
            const frameTimes = [];
            for (let batch = 0; batch < 3; batch++) {
              const start = performance.now();
              for (let frame = 0; frame < 60; frame++) {
                const frameStart = performance.now();
                await render();
                frameTimes.push(performance.now() - frameStart);
              }
              batches.push((performance.now() - start) / 60);
            }
            frameTimes.sort((a, b) => a - b);
            const row = {
              name,
              titleVisible,
              frames: frameTimes.length,
              warmupFrames: 30,
              batchMeanFrameMs: batches,
              meanFrameMs: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
              medianFrameMs: frameTimes[Math.floor(frameTimes.length / 2)],
              p95FrameMs: frameTimes[Math.floor(frameTimes.length * 0.95)],
              targetAllocations: targetAllocations - startAllocations,
              targetAllocatedBytes: targetAllocatedBytes - startBytes,
              textureDeletes: textureDeletes - startDeletes,
              framebufferCreates: framebufferCreates - startFboCreates,
              framebufferDeletes: framebufferDeletes - startFboDeletes,
              sourceCacheBytes: compositor.sourceTargets?.weight ?? null,
              imageCacheBytes: compositor.imageTargets?.weight ?? null,
            };
            if (
              label === "after" &&
              (row.targetAllocations ||
                row.textureDeletes ||
                row.framebufferCreates ||
                row.framebufferDeletes)
            )
              throw new Error(`Steady-state cache thrashing: ${JSON.stringify(row)}`);
            workingSets.push(row);
          }
          oversizedFrame.close();
          bigFrame.close();
          smallFrame.close();
          for (const bitmap of stills) bitmap.close();
          compositor.dispose();
          if (liveFramebuffers.size !== 0) throw new Error(`FBO leak: ${liveFramebuffers.size}`);
          if (resident !== 0) throw new Error(`Texture leak: ${resident}`);
          return {
            label,
            assets: assets.length,
            source: [3840, 2160],
            renderer,
            precision: compositor.colorPrecision ?? "rgba8-unmanaged",
            budgets: {
              sourceBytes: Compositor.SOURCE_TARGET_BYTES ?? null,
              imageBytes: Compositor.IMAGE_TARGET_BYTES ?? null,
              maxSingleTargetBytes: Compositor.MAX_SOURCE_TARGET_BYTES ?? null,
            },
            elapsedMs,
            heapBefore,
            heapAfter,
            retainedTextureBytes,
            peakTextureBytes: benchmarkPeak,
            cachedImageBytes,
            oversizedAndResolutionChurn: stress,
            workingSets,
            textureBytesAfterDispose: resident,
            framebuffersAfterDispose: liveFramebuffers.size,
          };
        },
        { label, implementation },
      ),
    );
    await page.close();
  }
  const report = {
    baseline,
    metric:
      "Instrumented WebGL requested texture bytes, excluding driver overhead, constructor probes and browser image/canvas backing; JS heap after explicit GC. Actual Compositor rendering 1000 distinct 4K ImageBitmaps in a 1000-asset library, sequentially released source decodes, followed by simultaneous-source warm steady-state workloads using real text rasterization and VideoFrame uploads (decode time excluded); no import/OPFS benchmark.",
    rows,
  };
  writeFileSync(
    path.join(root, "docs/evaluations/2026-09-07-color-cache-memory-round4.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI benchmark report.
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
