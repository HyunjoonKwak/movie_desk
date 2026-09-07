// Compare checked-in baseline scope arithmetic with the current worker kernels.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compile = (source) => {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  // Only repository-owned arithmetic source; no untrusted input.
  new Function("exports", code)(exports);
  return exports;
};
const old = compile(readFileSync(new URL("./scopes-baseline.fixture.ts", import.meta.url), "utf8"));
const next = compile(
  readFileSync(new URL("../../apps/web/src/scopes/compute.ts", import.meta.url), "utf8"),
);
const run = (kernels, width, height) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4)
    pixels.set([i % 256, (i >> 4) % 256, (i >> 8) % 256, 255], i);
  const times = [];
  for (let i = 0; i < 220; i++) {
    const start = performance.now();
    kernels.computeHistogram(pixels);
    kernels.computeLumaWaveform(pixels, width, height);
    kernels.computeVectorscope(pixels);
    if (i >= 20) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const red = new Uint8ClampedArray([255, 0, 0, 255]);
  const index = kernels.computeVectorscope(red).findIndex((v) => v > 0);
  return {
    width,
    height,
    threeKernelsMs: { p50: times[100], p95: times[190] },
    redVector: { x: index % 256, y: Math.floor(index / 256) },
  };
};
const result = {
  baseline: run(old, 240, 135),
  current: run(next, 256, 144),
  note: "Node CPU kernel comparison, all three original scopes per iteration; current app runs selected kernel and painting in a worker. This is not GPU readback latency.",
};
writeFileSync(
  new URL("../../docs/evaluations/2026-09-07-color-scopes-kernels.json", import.meta.url),
  `${JSON.stringify(result, null, 2)}\n`,
);
