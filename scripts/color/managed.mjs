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
const verifyOnly = process.argv.includes("--verify");
const newModules = modules();
const oldModules = verifyOnly ? newModules : modules("0e6804a");
const legacyJs = ts.transpileModule(
  readFileSync(new URL("./legacy-bypass.fixture.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(
    async ({ oldModules, newModules, legacyJs }) => {
      const frozen = {};
      new Function("exports", legacyJs)(frozen);
      const sources = new Map();
      const luts = new Map();
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
          getFrameProvider: () => ({ retain() {}, has: () => true, framesFor: () => null }),
        },
        "apps/web/src/renderer/shape-source.ts": {},
        "apps/web/src/renderer/text-source.ts": {},
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
      const old = load(oldModules);
      const current = load(newModules);
      const assert = (ok, message) => {
        if (!ok) throw new Error(message);
      };
      const source = document.createElement("canvas");
      source.width = 256;
      source.height = 144;
      const ctx = source.getContext("2d");
      const data = ctx.createImageData(256, 144);
      for (let y = 0; y < 144; y++)
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4;
          data.data.set([x, x, x, 255], i);
        }
      ctx.putImageData(data, 0, 0);
      sources.set("source", source);
      function create(implementation, effects = [], width = 256, height = 144) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const compositor = new implementation.Compositor(canvas);
        compositor.resize(width, height);
        const asset = { id: "source", kind: "image", width: source.width, height: source.height };
        const clip = {
          id: "clip",
          kind: "media",
          assetId: "source",
          start: 0,
          duration: 10000,
          trimIn: 0,
          speed: 1,
          keyframes: [],
          effects,
        };
        const project = {
          id: "project",
          resolution: { w: width, h: height },
          mediaLibrary: [asset],
          timeline: {
            playhead: 0,
            duration: 10000,
            transitions: [],
            tracks: [{ id: "track", kind: "video", clips: [clip] }],
          },
        };
        const gl = canvas.getContext("webgl2");
        return {
          canvas,
          compositor,
          project,
          asset,
          clip,
          gl,
          async render() {
            await compositor.renderFrame(project, () => asset);
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            assert(gl.getError() === 0, "GL error");
            return pixels;
          },
        };
      }
      const legacy = create(old);
      const managed = create(current);
      const before = await legacy.render();
      const after = await managed.render();
      let mismatch = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) mismatch++;
      assert(mismatch === 0, `Bypass mismatch ${mismatch}`);
      const frozenRamp = frozen.legacyBypassPixels(source, 256, 144);
      assert(
        after.every((x, i) => x === frozenRamp[i]),
        "Frozen legacy ramp mismatch",
      );
      const effects = [];
      for (const def of current.effects.filter((d) => d.passes.length && d.type !== "lut")) {
        const params = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
        if (def.type === "exposure") params.stops = 1;
        const fx = { id: "fx", type: def.type, enabled: true, params };
        legacy.clip.effects = [fx];
        managed.clip.effects = [fx];
        const b = await legacy.render();
        const a = await managed.render();
        effects.push({
          type: def.type,
          space: def.workingSpace,
          params,
          oldGray118: [...b.slice(118 * 4, 118 * 4 + 4)],
          newGray118: [...a.slice(118 * 4, 118 * 4 + 4)],
        });
      }
      const adjustedEffects = [];
      for (const [type, params] of [
        ["white-balance", { temperature: 0.5, tint: 0.2 }],
        ["color-wheels", { gainR: 0.25, gainG: 0.25, gainB: 0.25 }],
      ]) {
        const neutral = effects.find((effect) => effect.type === type);
        assert(
          neutral.newGray118.slice(0, 3).every((code) => code === 118),
          `${type} neutral identity`,
        );
        legacy.clip.effects = managed.clip.effects = [
          { id: "adjusted", type, enabled: true, params },
        ];
        const before = await legacy.render();
        const after = await managed.render();
        const linearGray = ((118 / 255 + 0.055) / 1.055) ** 2.4;
        const referenceLinear =
          type === "white-balance"
            ? [linearGray + 0.09, linearGray - 0.03, linearGray - 0.06]
            : [linearGray * 1.25, linearGray * 1.25, linearGray * 1.25];
        const expected = referenceLinear.map((v) =>
          Math.round((1.055 * v ** (1 / 2.4) - 0.055) * 255),
        );
        const actual = [...after.slice(118 * 4, 118 * 4 + 3)];
        assert(
          actual.every((code, i) => Math.abs(code - expected[i]) <= 1),
          `${type} must operate on linear light`,
        );
        adjustedEffects.push({
          type,
          params,
          before: [...before.slice(118 * 4, 118 * 4 + 3)],
          after: actual,
          expected,
        });
      }
      const exposure = effects.find((e) => e.type === "exposure");
      assert(
        exposure.newGray118[0] === 162,
        `Exposure must yield code 162: ${JSON.stringify(exposure)}`,
      );
      const precision = managed.compositor.colorPrecision;
      managed.clip.effects = [
        { id: "up", type: "exposure", enabled: true, params: { stops: 3 } },
        { id: "down", type: "exposure", enabled: true, params: { stops: -3 } },
      ];
      const retained = await managed.render();
      assert(retained[180 * 4] === 180, `Unbounded highlights lost: ${retained[180 * 4]}`);
      managed.clip.effects = [{ id: "up", type: "exposure", enabled: true, params: { stops: 1 } }];
      await managed.render();
      const floatPixels = new Float32Array(4);
      managed.gl.bindFramebuffer(
        managed.gl.FRAMEBUFFER,
        managed.compositor.colorScratch.acquire(3).fbo,
      );
      managed.gl.readPixels(118, 0, 1, 1, managed.gl.RGBA, managed.gl.FLOAT, floatPixels);
      const decoded118 = ((118 / 255 + 0.055) / 1.055) ** 2.4;
      const linearGain = floatPixels[0] / decoded118;
      assert(Math.abs(linearGain - 2) < 0.003, `Linear gain ${linearGain}`);
      const ext = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return name === "EXT_color_buffer_float" ? null : ext.call(this, name);
      };
      let fallback;
      try {
        fallback = create(current, managed.clip.effects);
      } finally {
        WebGL2RenderingContext.prototype.getExtension = ext;
      }
      const checkFramebuffer = WebGL2RenderingContext.prototype.checkFramebufferStatus;
      let unsupported;
      try {
        WebGL2RenderingContext.prototype.checkFramebufferStatus = function () {
          return this.FRAMEBUFFER_UNSUPPORTED;
        };
        unsupported = create(current);
      } finally {
        WebGL2RenderingContext.prototype.checkFramebufferStatus = checkFramebuffer;
      }
      assert(
        unsupported.compositor.colorPrecision === "unsupported",
        "Unsupported target detection",
      );
      const unsupportedBypass = await unsupported.render();
      assert(
        unsupportedBypass.every((code, i) => code === before[i]),
        "Unsupported targets must retain opaque bypass",
      );
      unsupported.clip.effects = managed.clip.effects;
      let rejected = false;
      try {
        await unsupported.render();
      } catch {
        rejected = true;
      }
      assert(rejected, "Unsupported targets must refuse managed color operations");
      unsupported.compositor.dispose();
      unsupported.gl.getExtension("WEBGL_lose_context")?.loseContext();
      const fallbackPixels = await fallback.render();
      assert(fallback.compositor.colorPrecision === "srgb8", "Fallback not selected");
      assert(
        Math.abs(fallbackPixels[118 * 4] - 162) <= 2,
        `Fallback exposure ${fallbackPixels[118 * 4]}`,
      );
      const attenuation = [
        { id: "dark", type: "exposure", enabled: true, params: { stops: -3 } },
        { id: "bright", type: "exposure", enabled: true, params: { stops: 3 } },
      ];
      managed.clip.effects = fallback.clip.effects = attenuation;
      const floatRamp = await managed.render();
      const fallbackRamp = await fallback.render();
      const rampStats = (pixels) => ({
        uniqueCodes: new Set(Array.from({ length: 256 }, (_, x) => pixels[x * 4])).size,
        maxError: Math.max(...Array.from({ length: 256 }, (_, x) => Math.abs(pixels[x * 4] - x))),
      });
      const precisionRamp = { float: rampStats(floatRamp), srgb8: rampStats(fallbackRamp) };
      luts.set("quarter", { raw: "LUT_1D_SIZE 2\n0 0 0\n0.25 0.25 0.25\n" });
      const lutRows = [];
      for (const colorSpace of ["srgb", "bt709", "linear"]) {
        managed.clip.effects = [
          {
            id: "lut",
            type: "lut",
            enabled: true,
            params: { lutId: "quarter", colorSpace, intensity: 1 },
          },
        ];
        const pixels = await managed.render();
        lutRows.push({ colorSpace, code118: pixels[118 * 4] });
      }
      assert(
        new Set(lutRows.map((r) => r.code118)).size === 3,
        "LUT domains did not affect pixels",
      );
      // Opaque white with 50% clip opacity must composite to linear 0.5 over black.
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 256, 144);
      managed.clip.effects = [];
      fallback.clip.effects = [];
      managed.clip.transform = fallback.clip.transform = {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 0.5,
      };
      const blend = await managed.render();
      const fallbackBlend = await fallback.render();
      assert(
        blend[0] === 188 && Math.abs(fallbackBlend[0] - 188) <= 1,
        `Linear blend ${blend[0]} / ${fallbackBlend[0]}`,
      );
      // Straight alpha enters the managed path even with no effects.
      ctx.clearRect(0, 0, 256, 144);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(0, 0, 256, 144);
      managed.clip.transform = undefined;
      managed.clip.effects = [];
      legacy.clip.effects = [];
      const alphaOld = await legacy.render();
      const alphaNew = await managed.render();
      assert(alphaNew[0] === 188, `Alpha must be linear: ${alphaNew[0]}`);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 256, 144);
      ctx.fillStyle = "white";
      ctx.fillRect(128, 0, 128, 144);
      const blurFx = [{ id: "blur", type: "gaussian-blur", enabled: true, params: { sigma: 2 } }];
      legacy.clip.effects = managed.clip.effects = blurFx;
      const blurOld = await legacy.render();
      const blurNew = await managed.render();
      assert(Math.abs(blurNew[127 * 4] - 170) <= 2, `Linear blur edge ${blurNew[127 * 4]}`);
      const inputRows = [];
      const { decodeTransfer, encodeTransfer } = current.get("apps/web/src/renderer/color.ts");
      managed.clip.effects = [
        { id: "identity", type: "exposure", enabled: true, params: { stops: 0 } },
      ];
      legacy.clip.effects = [];
      for (const [name, format, bytes, colorSpace] of [
        [
          "WebCodecs RGB sRGB",
          "RGBA",
          [180, 100, 60, 255],
          { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
        ],
        [
          "WebCodecs RGB BT709",
          "RGBA",
          [180, 100, 60, 255],
          { primaries: "bt709", transfer: "bt709", matrix: "rgb", fullRange: true },
        ],
        [
          "WebCodecs RGB P3",
          "RGBA",
          [180, 100, 60, 255],
          { primaries: "smpte432", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
        ],
        [
          "WebCodecs I420 BT709",
          "I420",
          [117, 117, 117, 117, 128, 128],
          { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
        ],
        [
          "WebCodecs NV12 BT709",
          "NV12",
          [117, 117, 117, 117, 128, 128],
          { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
        ],
      ]) {
        const frame = new VideoFrame(new Uint8Array(bytes), {
          format,
          codedWidth: format === "RGBA" ? 1 : 2,
          codedHeight: format === "RGBA" ? 1 : 2,
          timestamp: 0,
          colorSpace,
        });
        sources.set("source", frame);
        const oldPixels = await legacy.render();
        const newPixels = await managed.render();
        const expected =
          colorSpace.transfer === "bt709"
            ? format === "RGBA"
              ? bytes
                  .slice(0, 3)
                  .map((x) => encodeTransfer(decodeTransfer(x / 255, "bt709"), "srgb") * 255)
              : Array(3).fill(
                  encodeTransfer(decodeTransfer((117 - 16) / 219, "bt709"), "srgb") * 255,
                )
            : [...oldPixels.slice(0, 3)];
        assert(
          expected.every((x, i) => Math.abs(newPixels[i] - x) <= 2),
          `${name}: input transfer ${newPixels.slice(0, 3)} vs ${expected}`,
        );
        inputRows.push({
          name,
          oldRgb: [...oldPixels.slice(0, 3)],
          newRgb: [...newPixels.slice(0, 3)],
          expected,
        });
        frame.close();
      }
      const image = new Image();
      image.src = source.toDataURL();
      await image.decode();
      for (const [name, input] of [
        ["HTML image sRGB PNG", image],
        ["ImageBitmap sRGB", await createImageBitmap(image)],
      ]) {
        sources.set("source", input);
        const a = await legacy.render();
        const b = await managed.render();
        assert(
          a.every((x, i) => x === b[i]),
          `${name} identity mismatch`,
        );
        inputRows.push({
          name,
          oldRgb: [...a.slice(0, 3)],
          newRgb: [...b.slice(0, 3)],
          mismatches: 0,
        });
        if (input instanceof ImageBitmap) input.close();
      }
      source.width = 2;
      source.height = 1;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = "white";
      ctx.fillRect(1, 0, 1, 1);
      sources.set("source", source);
      const resizeOld = create(old, [], 1, 1);
      const resizeNew = create(current, [], 1, 1);
      const resizedOld = await resizeOld.render();
      const resizedNew = await resizeNew.render();
      assert(resizedNew[0] === 188, `Linear resampling ${resizedNew[0]}`);
      resizeOld.compositor.dispose();
      resizeNew.compositor.dispose();
      fallback.compositor.dispose();
      const video = document.createElement("video");
      video.muted = true;
      video.src = "/fixture.mp4";
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      sources.set("source", video);
      const videoOld = create(old, [], video.videoWidth, video.videoHeight);
      const videoNew = create(current, [], video.videoWidth, video.videoHeight);
      for (const instance of [videoOld, videoNew]) {
        instance.asset.width = video.videoWidth;
        instance.asset.height = video.videoHeight;
        instance.asset.kind = "video";
      }
      const vb = await videoOld.render();
      const va = await videoNew.render();
      let videoMismatches = 0;
      for (let i = 0; i < vb.length; i++) if (vb[i] !== va[i]) videoMismatches++;
      assert(videoMismatches === 0, `Real fixture mismatch ${videoMismatches}`);
      const frozenVideo = frozen.legacyBypassPixels(video, video.videoWidth, video.videoHeight);
      assert(
        va.every((x, i) => x === frozenVideo[i]),
        "Frozen legacy real fixture mismatch",
      );
      videoOld.compositor.dispose();
      videoNew.compositor.dispose();
      source.width = 1920;
      source.height = 1080;
      ctx.fillStyle = "rgb(118,118,118)";
      ctx.fillRect(0, 0, 1920, 1080);
      sources.set("source", source);
      const performanceRows = [];
      for (const [name, implementation] of [
        ["legacy", old],
        ["managed", current],
      ]) {
        const instance = create(
          implementation,
          [{ id: "up", type: "exposure", enabled: true, params: { stops: 1 } }],
          1920,
          1080,
        );
        const times = [];
        for (let i = 0; i < 70; i++) {
          const start = performance.now();
          await instance.compositor.renderFrame(instance.project, () => instance.asset);
          instance.gl.finish();
          if (i >= 10) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        performanceRows.push({
          name,
          width: 1920,
          height: 1080,
          samples: times.length,
          p50Ms: times[30],
          p95Ms: times[57],
          meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        });
        instance.compositor.dispose();
      }
      const playbackRows = [];
      for (const [name, implementation] of [
        ["legacy", old],
        ["managed", current],
      ]) {
        const instance = create(
          implementation,
          [{ id: "up", type: "exposure", enabled: true, params: { stops: 1 } }],
          1920,
          1080,
        );
        instance.canvas.style.width = "960px";
        instance.canvas.style.height = "540px";
        document.body.append(instance.canvas);
        const intervals = [];
        const submissions = [];
        let previous = 0;
        for (let i = 0; i < 130; i++) {
          const now = await new Promise((resolve) => requestAnimationFrame(resolve));
          const at = performance.now();
          await instance.compositor.renderFrame(instance.project, () => instance.asset);
          if (i > 10) {
            intervals.push(now - previous);
            submissions.push(performance.now() - at);
          }
          previous = now;
        }
        const stats = (xs) => {
          xs.sort((a, b) => a - b);
          return {
            count: xs.length,
            p50: xs[Math.floor(xs.length * 0.5)],
            p95: xs[Math.floor(xs.length * 0.95)],
            max: xs.at(-1),
          };
        };
        const extension = instance.gl.getExtension("WEBGL_debug_renderer_info");
        playbackRows.push({
          name,
          width: 1920,
          height: 1080,
          intervalMs: stats(intervals),
          submissionMs: stats(submissions),
          renderer: extension
            ? instance.gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : "unavailable",
        });
        instance.compositor.dispose();
        instance.canvas.remove();
      }
      legacy.compositor.dispose();
      managed.compositor.dispose();
      return {
        bypass: { channels: before.length, mismatches: mismatch },
        realFixture: { channels: vb.length, mismatches: videoMismatches },
        precision,
        linearGain,
        blend: { float: blend[0], srgb8: fallbackBlend[0] },
        fallbackExposure: fallbackPixels[118 * 4],
        highlightsRoundTrip180: retained[180 * 4],
        precisionRamp,
        lutRows,
        performanceRows,
        playbackRows,
        inputRows,
        alpha: { old: alphaOld[0], managed: alphaNew[0] },
        blur: { old: blurOld[127 * 4], managed: blurNew[127 * 4] },
        resize: { old: resizedOld[0], managed: resizedNew[0] },
        effects,
        adjustedEffects,
      };
    },
    { oldModules, newModules, legacyJs },
  );
  if (!verifyOnly)
    writeFileSync(
      path.join(
        root,
        metal
          ? "docs/evaluations/2026-09-07-color-managed-metal.json"
          : "docs/evaluations/2026-09-07-color-managed.json",
      ),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  // biome-ignore lint/suspicious/noConsole: CLI measurement output.
  console.log(verifyOnly ? "Managed color GPU invariants PASS" : JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
