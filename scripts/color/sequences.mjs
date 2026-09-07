import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { reentryBundle } from "./reentry-bundle.mjs";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const server = createServer((_, response) =>
  response.end("<!doctype html><title>Sequence pixels</title>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ args: ["--use-angle=metal"] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: reentryBundle() });
  const result = await page.evaluate(async () => {
    const fixture = window.__reentry;
    const assert = (ok, message) => {
      if (!ok) throw new Error(message);
    };
    const base = {
      start: 0,
      duration: 10000,
      trimIn: 0,
      trimOut: 0,
      speed: 1,
      effects: [],
      keyframes: [],
    };
    const media = { ...base, id: "media", kind: "media", assetId: "image" };
    const sequence = (id) => ({ ...base, id: `ref-${id}`, kind: "sequence", timelineId: id });
    const timeline = (id, clips) => ({
      id,
      playhead: 0,
      duration: 10000,
      tracks: clips.map((clip, i) => ({ id: `${id}-${i}`, kind: "video", clips: [clip] })),
    });
    const asset = { id: "image", kind: "image", width: 1920, height: 1080 };
    const videoAsset = { ...asset, id: "video", kind: "video" };
    const source = document.createElement("canvas");
    source.width = 1920;
    source.height = 1080;
    source.getContext("2d").fillStyle = "#4080c0";
    source.getContext("2d").fillRect(0, 0, 1920, 1080);
    fixture.sources.set(asset.id, source);
    const project = (timelines) => ({
      id: "sequences",
      rootTimelineId: timelines[0].id,
      timelines,
      timeline: timelines[0],
      resolution: { w: 1920, h: 1080 },
      mediaLibrary: [asset, videoAsset],
    });
    const create = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const compositor = new fixture.Compositor(canvas);
      const gl = canvas.getContext("webgl2");
      const counters = {
        textureCreates: 0,
        textureDeletes: 0,
        targetAllocations: 0,
        fboCreates: 0,
        fboDeletes: 0,
      };
      for (const [method, counter] of [
        ["createTexture", "textureCreates"],
        ["deleteTexture", "textureDeletes"],
        ["createFramebuffer", "fboCreates"],
        ["deleteFramebuffer", "fboDeletes"],
      ]) {
        const original = gl[method].bind(gl);
        gl[method] = (...args) => {
          counters[counter]++;
          return original(...args);
        };
      }
      const upload = gl.texImage2D.bind(gl);
      gl.texImage2D = (...args) => {
        if (args.length === 9 && args[3] > 2 && args[4] > 2) counters.targetAllocations++;
        return upload(...args);
      };
      const pixel = (x = 960, y = 540, target = null) => {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
        const bytes = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        assert(!gl.isContextLost() && gl.getError() === 0, "GL failure");
        return [...bytes];
      };
      const render = async (p, options) => {
        let timeout;
        try {
          await Promise.race([
            compositor.renderFrame(p, (id) => p.mediaLibrary.find((a) => a.id === id), options),
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("recursive source queue deadlock")),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        gl.finish();
        return pixel();
      };
      return { compositor, gl, counters, pixel, render };
    };
    const instance = create();
    const evidence = [];
    const expected = (name, actual, wanted, tolerance = 1) => {
      assert(
        actual.every((v, i) => Math.abs(v - wanted[i]) <= tolerance),
        `${name}: ${actual} != ${wanted}`,
      );
      evidence.push({ name, actual, expected: wanted, tolerance });
    };
    const nested = (levels, leaf = [media]) =>
      project(
        Array.from({ length: levels + 1 }, (_, i) =>
          timeline(`t${i}`, i === levels ? leaf : [sequence(`t${i + 1}`)]),
        ),
      );
    expected("direct positive control", await instance.render(nested(0)), [64, 128, 192, 255]);
    expected(
      "one nested level, media source queue completes",
      await instance.render(nested(1)),
      [64, 128, 192, 255],
    );
    expected("two nested levels", await instance.render(nested(2)), [64, 128, 192, 255]);
    expected(
      "eight timeline levels accepted",
      await instance.render(nested(7)),
      [64, 128, 192, 255],
    );
    for (const [name, p] of [
      ["missing target", project([timeline("root", [sequence("missing")])])],
      ["self cycle", project([timeline("root", [sequence("root")])])],
      [
        "indirect cycle",
        project([
          timeline("root", [sequence("a")]),
          timeline("a", [sequence("b"), media]),
          timeline("b", [sequence("a")]),
        ]),
      ],
      ["depth exceeded", nested(8)],
    ])
      expected(name, await instance.render(p), [0, 0, 0, 255], 0);
    const shape = {
      ...base,
      id: "shape",
      kind: "shape",
      shape: "rect",
      fill: "#ff0000",
      stroke: "transparent",
      strokeWidth: 0,
    };
    const transparent = project([
      timeline("root", [sequence("child"), media]),
      timeline("child", [shape]),
    ]);
    await instance.render(transparent);
    expected("child shape center", instance.pixel(), [255, 0, 0, 255]);
    expected(
      "transparent child preserves parent corner",
      instance.pixel(0, 0),
      [64, 128, 192, 255],
    );
    const alpha = nested(1, [
      { ...shape, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5 } },
    ]);
    alpha.timeline.tracks.push({ id: "backdrop", kind: "video", clips: [media] });
    expected("child premultiplied transfer", await instance.render(alpha), [192, 92, 140, 255], 2);
    const empty = nested(1, []);
    expected(
      "empty child target clears reused pixels",
      await instance.render(empty),
      [0, 0, 0, 255],
      0,
    );
    const effected = nested(1);
    effected.timeline.tracks[0].clips[0].effects = [
      { id: "gain", type: "exposure", enabled: true, params: { stops: 1 } },
    ];
    expected(
      "parent effect processes child in linear light",
      await instance.render(effected),
      [90, 176, 255, 255],
      2,
    );
    const frame = new VideoFrame(source, { timestamp: 0 });
    const times = [];
    const providerModule = fixture.get("apps/web/src/renderer/webcodecs-decoder.ts");
    const originalProvider = providerModule.getFrameProvider;
    let retainedVideos;
    let retainedSources;
    providerModule.getFrameProvider = () => ({
      ...originalProvider(),
      retain: (ids) => {
        retainedVideos = new Set(ids);
      },
    });
    instance.compositor.sources.retain = (ids) => {
      retainedSources = new Set(ids);
    };
    fixture.decoded.set("video", (time) => {
      times.push(time);
      return frame;
    });
    const timed = nested(2, [{ ...media, assetId: "video" }]);
    Object.assign(timed.timeline.tracks[0].clips[0], { start: 100, trimIn: 200, speed: 2 });
    Object.assign(timed.timelines[1].tracks[0].clips[0], { trimIn: 50, speed: 0.5 });
    expected(
      "mapped video time pixels",
      await instance.render(timed, { playhead: 600 }),
      [64, 128, 192, 255],
    );
    assert(
      retainedVideos.has("video") && retainedSources.has("video"),
      "nested video missing from retain sets",
    );
    evidence.push({
      name: "nested media retained by source pool and frame provider",
      video: retainedVideos.has("video"),
      source: retainedSources.has("video"),
    });
    providerModule.getFrameProvider = originalProvider;
    assert(times.at(-1) === 650, `nested time ${times}`);
    evidence.push({ name: "nested trim/speed timestamp", actual: times.at(-1), expected: 650 });
    const ramp = nested(1, [{ ...media, assetId: "video" }]);
    Object.assign(ramp.timeline.tracks[0].clips[0], {
      trimIn: 100,
      keyframes: [
        {
          target: "speed",
          keyframes: [
            { at: 0, value: 1, easing: "linear" },
            { at: 1000, value: 3, easing: "linear" },
          ],
        },
      ],
    });
    await instance.render(ramp, { playhead: 500 });
    assert(Math.abs(times.at(-1) - 845) < 0.01, `ramp timestamp ${times.at(-1)}`);
    evidence.push({ name: "speed ramp integral timestamp", actual: times.at(-1), expected: 845 });
    // A suspended independent root occupies lane zero. The nested root must
    // keep ancestry [root, child], even though its lane numbers begin at one.
    let release;
    let entered;
    const waiting = new Promise((resolve) => {
      entered = resolve;
    });
    fixture.sourceHook = async () => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    };
    const firstTarget = instance.compositor.acquireChildTarget(30, 1920, 1080);
    const secondTarget = instance.compositor.acquireChildTarget(31, 1920, 1080);
    const pending = instance.compositor.renderFrame(nested(0), () => asset, {
      target: firstTarget,
    });
    await waiting;
    expected(
      "independent root ancestry despite occupied lane",
      await instance
        .render(nested(1, [shape]), { target: secondTarget })
        .then(() => instance.pixel(960, 540, secondTarget.fbo)),
      [255, 0, 0, 255],
    );
    fixture.sourceHook = null;
    release();
    await pending;
    firstTarget.release();
    secondTarget.release();
    frame.close();
    instance.compositor.dispose();
    // Same-page paired batches with alternating order, following paired-frames.
    // This compares nesting overhead against a visually identical flat frame.
    const title = {
      ...base,
      id: "title",
      kind: "text",
      text: "Nested visual",
      font: "sans-serif",
      size: 80,
      color: "#ffffff",
      shadow: false,
    };
    const rows = [];
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const level of [1, 2]) {
      const instances = [create(), create()];
      const projects = [nested(0, [title, shape, media]), nested(level, [title, shape, media])];
      const render = async (i) => {
        await instances[i].render(projects[i]);
        expectedPixel(instances[i].pixel(0, 0));
      };
      const expectedPixel = (p) =>
        assert(
          p.every((v, i) => Math.abs(v - [64, 128, 192, 255][i]) <= 1),
          `perf black frame ${p}`,
        );
      for (let i = 0; i < 30; i++) for (const index of [0, 1]) await render(index);
      for (const item of instances)
        for (const key of Object.keys(item.counters)) item.counters[key] = 0;
      const batches = [[], []];
      const samples = [[], []];
      for (let batch = 0; batch < 10; batch++) {
        for (const i of batch % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          for (let j = 0; j < 30; j++) {
            const at = performance.now();
            await render(i);
            samples[i].push(performance.now() - at);
          }
          batches[i].push((performance.now() - start) / 30);
        }
      }
      rows.push({
        nestedLevels: level,
        rows: instances.map((item, i) => {
          assert(
            Object.values(item.counters).every((v) => v === 0),
            `cache churn ${JSON.stringify(item.counters)}`,
          );
          return {
            implementation: i ? "nested" : "flat",
            frames: samples[i].length,
            p50Ms: median(samples[i]),
            p95Ms: [...samples[i]].sort((a, b) => a - b)[285],
            batchMeans: batches[i],
            counters: { ...item.counters },
          };
        }),
        medianPairedRatio: median(batches[0].map((v, i) => batches[1][i] / v)),
      });
      for (const item of instances) item.compositor.dispose();
    }
    return { evidence, performance: rows };
  });
  const report = {
    protocol:
      "Real production shaders/compositor with stubbed source I/O; 1920x1080 Metal, expected RGBA pixels, five-second render deadlock timeout; 30 warmups and ten alternating paired 30-frame batches, forced finish/readback per frame.",
    ...result,
  };
  writeFileSync(
    new URL("../../docs/evaluations/2026-09-08-b5-phase4-sequences.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI pixel evidence.
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
