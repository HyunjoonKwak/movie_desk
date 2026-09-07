import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { reentryBundle } from "./reentry-bundle.mjs";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const baseline = "84a26767d60bb58ddcdb05861492abacb41b13c9";
const server = createServer((_, response) =>
  response.end("<!doctype html><title>Phase 3 GPU audit</title>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ args: ["--use-angle=metal"] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: reentryBundle(baseline) });
  await page.evaluate(() => {
    window.__baseline = window.__reentry;
  });
  await page.addScriptTag({ content: reentryBundle() });
  const result = await page.evaluate(async () => {
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const before = window.__baseline;
    const after = window.__reentry;
    const create = (implementation, width = 256, height = 144) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const compositor = new implementation.Compositor(canvas);
      const gl = canvas.getContext("webgl2");
      return { canvas, compositor, gl, implementation };
    };
    const source = (id, width = 256, height = 144, alpha = false) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          image.data.set([x % 256, y % 256, (x + y) % 256, alpha ? (x * 7) % 256 : 255], i);
        }
      ctx.putImageData(image, 0, 0);
      before.sources.set(id, canvas);
      after.sources.set(id, canvas);
      return { id, kind: "image", width, height };
    };
    const asset = source("source");
    const clip = {
      id: "clip",
      kind: "media",
      assetId: asset.id,
      start: 0,
      duration: 10000,
      trimIn: 0,
      speed: 1,
      keyframes: [],
      effects: [],
    };
    const project = (clips = [clip], assets = [asset]) => ({
      id: "project",
      resolution: { w: 256, h: 144 },
      mediaLibrary: assets,
      timeline: { playhead: 0, duration: 10000, tracks: [{ id: "track", kind: "video", clips }] },
    });
    const pixels = (
      instance,
      width = instance.canvas.width,
      height = instance.canvas.height,
      fbo = null,
    ) => {
      const { gl } = instance;
      const old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
      const bytes = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old);
      assert(gl.getError() === 0, "GL readback error");
      return bytes;
    };
    const render = async (instance, p, options) => {
      await instance.compositor.renderFrame(
        p,
        (id) => p.mediaLibrary.find((a) => a.id === id),
        options,
      );
      return pixels(instance);
    };
    const a = create(before);
    const b = create(after);
    const comparisons = [];
    const compare = async (name, p) => {
      const clock = performance.now.bind(performance);
      performance.now = () => 123456;
      let expected;
      let actual;
      try {
        expected = await render(a, p);
        actual = await render(b, p);
      } finally {
        performance.now = clock;
      }
      assert(!a.compositor.invalidated && !a.gl.isContextLost(), `${name}: invalid baseline`);
      assert(!b.compositor.invalidated && !b.gl.isContextLost(), `${name}: invalid modified`);
      let minRgb = 255;
      let maxRgb = 0;
      for (let i = 0; i < expected.length; i++) {
        if (i % 4 === 3) continue;
        minRgb = Math.min(minRgb, expected[i]);
        maxRgb = Math.max(maxRgb, expected[i]);
      }
      assert(maxRgb - minRgb > 16, `${name}: missing gradient positive control`);
      let mismatches = 0;
      let maxDelta = 0;
      for (let i = 0; i < expected.length; i++)
        if (expected[i] !== actual[i]) {
          mismatches++;
          maxDelta = Math.max(maxDelta, Math.abs(expected[i] - actual[i]));
        }
      assert(mismatches === 0, `${name}: ${mismatches} mismatches, delta ${maxDelta}`);
      comparisons.push({ name, channels: actual.length, minRgb, maxRgb, mismatches, maxDelta });
    };
    await compare("opaque bypass", project());
    for (const fx of after.effects.filter((fx) => fx.passes.length && fx.type !== "lut")) {
      const params = Object.fromEntries(fx.params.map((p) => [p.key, p.default]));
      if (fx.type === "exposure") params.stops = 1;
      await compare(
        fx.type,
        project([{ ...clip, effects: [{ id: "effect", type: fx.type, enabled: true, params }] }]),
      );
    }
    const alpha = source("alpha", 256, 144, true);
    await compare("alpha bypass promotion", project([{ ...clip, assetId: alpha.id }], [alpha]));
    for (const blendMode of ["normal", "overlay", "soft-light", "multiply", "screen", "add"]) {
      await compare(
        `layered ${blendMode}`,
        project(
          [
            {
              ...clip,
              id: "upper",
              assetId: alpha.id,
              blendMode,
              transform: { x: 0.1, y: 0.05, scale: 0.8, rotation: 0.3, opacity: 0.7 },
            },
            clip,
          ],
          [alpha, asset],
        ),
      );
    }
    await compare(
      "fit and transform",
      project([
        { ...clip, fit: "fit", transform: { x: 0, y: 0, scale: 0.7, rotation: 0.4, opacity: 0.8 } },
      ]),
    );
    await compare(
      "adjustment",
      project([
        {
          id: "adjust",
          kind: "adjustment",
          start: 0,
          duration: 10000,
          speed: 1,
          keyframes: [],
          effects: [{ id: "gain", type: "exposure", enabled: true, params: { stops: 0.5 } }],
        },
        clip,
      ]),
    );
    const reference = await render(b, project());
    const target = b.compositor.acquireChildTarget(1, 80, 120);
    const readSentinel = b.gl.createFramebuffer();
    const drawSentinel = b.gl.createFramebuffer();
    b.gl.bindFramebuffer(b.gl.READ_FRAMEBUFFER, readSentinel);
    b.gl.bindFramebuffer(b.gl.DRAW_FRAMEBUFFER, drawSentinel);
    b.gl.viewport(3, 4, 7, 9);
    await b.compositor.renderFrame(
      project([{ ...clip, assetId: alpha.id }], [alpha]),
      () => alpha,
      { target, playhead: 500 },
    );
    assert(b.gl.getParameter(b.gl.READ_FRAMEBUFFER_BINDING) === readSentinel, "read binding lost");
    assert(b.gl.getParameter(b.gl.DRAW_FRAMEBUFFER_BINDING) === drawSentinel, "draw binding lost");
    assert([...b.gl.getParameter(b.gl.VIEWPORT)].join() === "3,4,7,9", "viewport lost");
    const child = pixels(b, 80, 120, target.fbo);
    assert(
      child.some((value, i) => i % 4 === 3 && value < 255),
      "child lost transparency",
    );
    b.gl.bindFramebuffer(b.gl.FRAMEBUFFER, null);
    const resumed = await render(b, project());
    assert(
      resumed.every((value, i) => value === reference[i]),
      "offscreen polluted screen",
    );
    target.release();
    b.gl.deleteFramebuffer(readSentinel);
    b.gl.deleteFramebuffer(drawSentinel);
    // A parent holds its scene while its source await is suspended. A child
    // at a different size completes first; the parent must resume unchanged.
    let unblock;
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = new Promise((resolve) => {
      unblock = resolve;
    });
    after.sourceHook = async () => {
      after.sourceHook = null;
      entered();
      await pending;
    };
    const effectProject = project([
      { ...clip, effects: [{ id: "gain", type: "exposure", enabled: true, params: { stops: 1 } }] },
    ]);
    const expectedParent = await render(a, effectProject);
    const parent = b.compositor.renderFrame(effectProject, () => asset);
    await started;
    const emptyTarget = b.compositor.acquireChildTarget(1, 47, 31);
    await b.compositor.renderFrame(project([]), () => undefined, {
      target: emptyTarget,
      playhead: 8000,
    });
    assert(
      pixels(b, 47, 31, emptyTarget.fbo).every((x) => x === 0),
      "empty child not transparent black",
    );
    unblock();
    await parent;
    assert(
      pixels(b).every((value, i) => value === expectedParent[i]),
      "suspended parent corrupted",
    );
    emptyTarget.release();
    // Numeric playhead must drive source time and visible content together.
    let sampled = -1;
    after.decoded.set("timed", (time) => {
      sampled = time;
      return null;
    });
    const timedAsset = { ...asset, id: "timed", kind: "video" };
    after.sources.set("timed", after.sources.get("source"));
    const timedProject = project(
      [{ ...clip, assetId: "timed", start: 100, trimIn: 300, speed: 2 }],
      [timedAsset],
    );
    await b.compositor.renderFrame(timedProject, () => timedAsset, { playhead: 600 });
    assert(sampled === 1300, `source playhead was ${sampled}`);
    // Capture an explicit target while another read/draw pair is bound.
    const captureTarget = b.compositor.acquireChildTarget(1, 256, 144);
    await b.compositor.renderFrame(project(), () => asset, { target: captureTarget });
    const sentinel = b.compositor.acquireChildTarget(2, 256, 144);
    b.gl.bindFramebuffer(b.gl.READ_FRAMEBUFFER, sentinel.fbo);
    b.gl.bindFramebuffer(b.gl.DRAW_FRAMEBUFFER, captureTarget.fbo);
    const capture = new after.Capture(b.canvas);
    const video = capture.capture(7, 33333, captureTarget);
    assert(
      b.gl.getParameter(b.gl.READ_FRAMEBUFFER_BINDING) === sentinel.fbo,
      "capture read restore",
    );
    assert(
      b.gl.getParameter(b.gl.DRAW_FRAMEBUFFER_BINDING) === captureTarget.fbo,
      "capture draw restore",
    );
    assert(video.timestamp === 7, "capture timestamp");
    video.close();
    const pipeline = new after.Pipeline(b.canvas);
    const converted = await pipeline.capture(8, 33333, captureTarget);
    assert(
      b.gl.getParameter(b.gl.READ_FRAMEBUFFER_BINDING) === sentinel.fbo,
      "pipeline read restore",
    );
    assert(
      b.gl.getParameter(b.gl.DRAW_FRAMEBUFFER_BINDING) === captureTarget.fbo,
      "pipeline draw restore",
    );
    converted.close();
    pipeline.dispose();
    b.gl.bindFramebuffer(b.gl.FRAMEBUFFER, null);
    captureTarget.release();
    sentinel.release();
    a.compositor.dispose();
    b.compositor.dispose();
    const timing = [];
    const big = source("big", 1920, 1080);
    const perfProject = project(
      [
        {
          ...clip,
          assetId: "big",
          effects: [{ id: "gain", type: "exposure", enabled: true, params: { stops: 1 } }],
        },
      ],
      [big],
    );
    perfProject.resolution = { w: 1920, h: 1080 };
    for (const [name, implementation] of [
      ["baseline", before],
      ["modified", after],
    ]) {
      const instance = create(implementation, 1920, 1080);
      let allocations = 0;
      let framebuffers = 0;
      let draws = 0;
      const originalDraw = instance.gl.drawArrays.bind(instance.gl);
      instance.gl.drawArrays = (...args) => {
        draws++;
        return originalDraw(...args);
      };
      const originalImage = instance.gl.texImage2D.bind(instance.gl);
      const originalFbo = instance.gl.createFramebuffer.bind(instance.gl);
      instance.gl.texImage2D = (...args) => {
        if (args.length === 9 && args[3] > 2 && args[4] > 2) allocations++;
        return originalImage(...args);
      };
      instance.gl.createFramebuffer = () => {
        framebuffers++;
        return originalFbo();
      };
      for (let i = 0; i < 10; i++) {
        await render(instance, perfProject);
        instance.gl.finish();
      }
      assert(
        pixels(instance)[0] > 0 || pixels(instance)[4] > 0,
        `${name}: empty performance fixture`,
      );
      const warmup = { allocations, framebuffers };
      allocations = framebuffers = draws = 0;
      const samples = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        await instance.compositor.renderFrame(perfProject, () => big);
        instance.gl.finish();
        pixels(instance, 1, 1); // Force identical completed-GPU readback in both implementations.
        assert(!instance.gl.isContextLost(), `${name}: context lost during timing`);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      timing.push({
        name,
        samples: samples.length,
        p50Ms: samples[30],
        p95Ms: samples[57],
        meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
        warmup,
        steady: { allocations, framebuffers, draws },
      });
      instance.compositor.dispose();
    }
    return { comparisons, reentry: "PASS", capture: "PASS", timing };
  });
  const report = { baseline, gpu: "ANGLE Metal requested", ...result };
  writeFileSync(
    new URL("../../docs/evaluations/2026-09-07-b5-phase3-gpu.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI evidence.
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
