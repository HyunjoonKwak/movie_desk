// Offline GPU baseline: execute the repository exposure/blur GLSL, not a CPU imitation.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const shader = (name) =>
  readFileSync(
    new URL(`../../apps/web/src/renderer/shaders/${name}.ts`, import.meta.url),
    "utf8",
  ).match(/`([\s\S]*?)`;/)[1];
const server = createServer((_, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.end("<!doctype html><title>Offline GPU color audit</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(
    ({ exposure, blur }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 1;
      const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error("WebGL2 unavailable");
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
        return s;
      };
      const vs = compile(
        gl.VERTEX_SHADER,
        "#version 300 es\nout vec2 v_uv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.-1.,0.,1.); }",
      );
      const program = (fs) => {
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        return p;
      };
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const ramp = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);
      const upload = (data, w = 256, h = 1) =>
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const draw = (p) => {
        gl.useProgram(p);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const read = () => {
        const out = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
      };
      const decode = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
      const e = program(exposure);
      upload(ramp);
      gl.useProgram(e);
      gl.uniform1f(gl.getUniformLocation(e, "u_stops"), 0);
      draw(e);
      const neutral = read();
      gl.uniform1f(gl.getUniformLocation(e, "u_stops"), 1);
      draw(e);
      const ev = read();
      const patches = [0, 16, 32, 64, 118, 128, 180, 230, 250, 255].map((input) => ({
        input,
        actual: ev[input * 4],
        linearReference: Math.round(encode(Math.min(1, decode(input / 255) * 2)) * 255),
        linearGain: input ? decode(ev[input * 4] / 255) / decode(input / 255) : null,
      }));
      const step = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++)
        step.set(i < 128 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
      upload(step);
      const b = program(blur);
      gl.useProgram(b);
      gl.uniform1f(gl.getUniformLocation(b, "u_sigma"), 2);
      gl.uniform2f(gl.getUniformLocation(b, "u_direction"), 1, 0);
      gl.uniform2f(gl.getUniformLocation(b, "u_texel"), 1 / 256, 1);
      draw(b);
      const blurred = read();
      const edge = [126, 127, 128, 129].map((x) => ({
        x,
        actual: blurred[x * 4],
        linearReference: Math.round(encode(blurred[x * 4] / 255) * 255),
      }));
      const bars = new Uint8Array(256 * 4);
      const colors = [
        [255, 255, 255],
        [255, 255, 0],
        [0, 255, 255],
        [0, 255, 0],
        [255, 0, 255],
        [255, 0, 0],
        [0, 0, 255],
        [0, 0, 0],
      ];
      for (let i = 0; i < 256; i++) bars.set([...colors[i >> 5], 255], i * 4);
      upload(bars);
      gl.useProgram(e);
      gl.uniform1f(gl.getUniformLocation(e, "u_stops"), 0);
      draw(e);
      const barOut = read();
      // A full-screen 50%-alpha white over opaque black, premultiplied source.
      upload(new Uint8Array([128, 128, 128, 128]), 1, 1);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      draw(e);
      const blend = read()[0];
      gl.disable(gl.BLEND);
      canvas.width = 1920;
      canvas.height = 1080;
      gl.viewport(0, 0, 1920, 1080);
      upload(ramp);
      const times = [];
      for (let i = 0; i < 70; i++) {
        const start = performance.now();
        draw(e);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.finish();
        if (i >= 10) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return {
        renderer: gl.getParameter(gl.RENDERER),
        halfFloatExtension: !!gl.getExtension("EXT_color_buffer_float"),
        passthroughMaxByteError: Math.max(...neutral.map((v, i) => Math.abs(v - ramp[i]))),
        colorBarMaxByteError: Math.max(...barOut.map((v, i) => Math.abs(v - bars[i]))),
        patches,
        blurEdge: edge,
        blend: { actual: blend, linearReference: Math.round(encode(128 / 255) * 255) },
        baseline1080pSinglePassMs: { p50: times[30], p95: times[57], samples: times.length },
        note: "Standalone real GLSL draws with 1-pixel readback and gl.finish; not full editor playback. Blur reference encodes measured weighted binary coverage (8-bit quantization).",
      };
    },
    { exposure: shader("exposure"), blur: shader("gaussian-blur") },
  );
  const output = `${JSON.stringify({ date: new Date().toISOString(), ...result }, null, 2)}\n`;
  if (process.argv[2]) writeFileSync(process.argv[2], output);
  else process.stdout.write(output);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
