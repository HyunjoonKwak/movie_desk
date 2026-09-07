import { expect, test } from "@playwright/test";
import type { Clip, MediaAsset, Project } from "@movie-desk/core";
import type { Compositor } from "../src/renderer/compositor";
import type { Bt709FrameCapture } from "../src/export/bt709-frame";
import { reentryBundle } from "../../../scripts/color/reentry-bundle.mjs";

interface Fixture {
  Compositor: typeof Compositor;
  Capture: typeof Bt709FrameCapture;
  sources: Map<string, HTMLCanvasElement>;
  sourceHook: (() => Promise<void>) | null;
  maskHook: (() => Promise<HTMLCanvasElement>) | null;
}

for (const [fallback, pressure] of [
  [false, false], [false, true], [true, false], [true, true],
]) {
  test(`compositor preserves offscreen ownership across async reentry (${fallback ? "srgb8" : "native"}, ${pressure ? "budget pressure" : "normal budget"})`, async ({ page }) => {
    await page.goto("/");
    if (fallback) {
      await page.evaluate(() => {
        const original = WebGL2RenderingContext.prototype.getExtension;
        WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
          return name === "EXT_color_buffer_float" ? null : original.call(this, name);
        } as typeof original;
      });
    }
    await page.addScriptTag({ content: reentryBundle() });
    const result = await page.evaluate(async ({ pressure, fallback }) => {
      const f = (window as unknown as { __reentry: Fixture }).__reentry;
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 64;
      if (pressure) {
        // Scale the unchanged accounting policy down to one source-sized slot
        // so exhaustion is deterministic without allocating hundreds of MiB.
        const budget = f.Compositor as unknown as { SOURCE_TARGET_BYTES: number };
        budget.SOURCE_TARGET_BYTES = 96 * 64 * (fallback ? 4 : 8);
      }
      const compositor = new f.Compositor(canvas);
      const gl = canvas.getContext("webgl2")!;
      const source = document.createElement("canvas");
      source.width = 96;
      source.height = 64;
      source.getContext("2d")!.fillStyle = "rgb(118,118,118)";
      source.getContext("2d")!.fillRect(0, 0, 96, 64);
      f.sources.set("asset", source);
      const asset = { id: "asset", kind: "image", width: 96, height: 64 } as MediaAsset;
      const clip = {
        id: "media", kind: "media", assetId: "asset", start: 0, duration: 2000,
        speed: 1, trimIn: 0, trimOut: 2000, volume: 1, keyframes: [],
        effects: [{ id: "gain", type: "exposure", enabled: true, params: { stops: 1 } }],
      } as unknown as Clip;
      const project = (clips: Clip[]) => ({
        id: "project", resolution: { w: 96, h: 64 }, mediaLibrary: [asset],
        timeline: { playhead: 0, duration: 2000, tracks: [{ id: "track", kind: "video", clips }] },
      }) as unknown as Project;
      const read = (width = 96, height = 64, fbo: WebGLFramebuffer | null = null) => {
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        const data = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        return data;
      };
      try {
        await compositor.renderFrame(project([clip]), () => asset);
        const expected = read();
        let release!: () => void;
        let entered!: () => void;
        const suspended = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const mask = document.createElement("canvas");
        mask.width = 96;
        mask.height = 64;
        mask.getContext("2d")!.fillStyle = "white";
        mask.getContext("2d")!.fillRect(0, 0, 96, 64);
        f.maskHook = async () => {
          entered();
          await suspended;
          return mask;
        };
        const masked = {
          ...clip,
          effects: [...clip.effects, {
            id: "mask", type: "bg-remove", enabled: true, params: { feather: 0.05 },
          }],
        } as unknown as Clip;
        const parent = compositor.renderFrame(project([masked]), () => asset);
        await started;
        const target = compositor.acquireChildTarget(1, 43, 71);
        const shape = {
          id: "child-shape", kind: "shape", shape: "rect", fill: "#ff0000", stroke: "#000000",
          strokeWidth: 0, start: 500, duration: 500, speed: 1, effects: [], keyframes: [],
        } as unknown as Clip;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.viewport(1, 2, 3, 4);
        await compositor.renderFrame(project([shape]), () => asset, { target, playhead: 600 });
        const bindings = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === target.fbo &&
          gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === null;
        const viewport = [...gl.getParameter(gl.VIEWPORT)];
        const child = read(43, 71, target.fbo);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        release();
        await parent;
        const actual = read();
        target.release();
        await compositor.renderFrame(project([clip]), () => asset);
        const next = read();
        const captureTarget = compositor.acquireChildTarget(1, 96, 64);
        await compositor.renderFrame(project([clip]), () => asset, { target: captureTarget });
        const sentinel = compositor.acquireChildTarget(2, 96, 64);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sentinel.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, captureTarget.fbo);
        const frame = new f.Capture(canvas).capture(123, 33333, captureTarget);
        const output = new Uint8Array(frame.allocationSize());
        await frame.copyTo(output);
        frame.close();
        const captureBindings = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === sentinel.fbo &&
          gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === captureTarget.fbo;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        captureTarget.release();
        sentinel.release();
        return {
          bindings, viewport, captureBindings,
          parentEqual: actual.every((v, i) => v === expected[i]),
          nextEqual: next.every((v, i) => v === expected[i]),
          childRed: child.some((v, i) => i % 4 === 0 && v > 200),
          childTransparent: child.some((v, i) => i % 4 === 3 && v === 0),
          expectedPixel: expected[0], capturedY: output[0], glError: gl.getError(),
        };
      } finally { compositor.dispose(); }
    }, { pressure, fallback });
    expect(result.bindings).toBe(true);
    expect(result.viewport).toEqual([1, 2, 3, 4]);
    expect(result.parentEqual).toBe(true);
    expect(result.nextEqual).toBe(true);
    expect(result.childRed).toBe(!pressure);
    expect(result.childTransparent).toBe(true);
    expect(result.captureBindings).toBe(true);
    expect(result.expectedPixel).toBeGreaterThan(155);
    expect(result.capturedY).toBeGreaterThan(130);
    expect(result.glError).toBe(0);
  });
}
