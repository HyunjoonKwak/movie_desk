import { type RenderTarget, screenTarget } from "@/renderer/render-target";
import { sampleSize } from "./compute";

export interface ScopePixels {
  pixels: Uint8ClampedArray;
  generation?: number;
  width: number;
  height: number;
  captureMs: number;
  readMs: number;
}

// A GPU downsample and nonblocking PBO read. The fence is polled only at rAF;
// getBufferSubData runs only after the driver signals completion. No gl.finish.
export class ScopeReadback {
  private readonly fbo: WebGLFramebuffer;
  private readonly renderbuffer: WebGLRenderbuffer;
  private readonly buffer: WebGLBuffer;
  private width = 0;
  private height = 0;
  private fence: WebGLSync | null = null;
  private raf = 0;
  private disposed = false;
  private pixels: Uint8ClampedArray | null = null;

  recycle(pixels: Uint8ClampedArray) {
    if (!this.disposed && pixels.byteLength === this.width * this.height * 4) this.pixels = pixels;
  }

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.fbo = gl.createFramebuffer()!;
    this.renderbuffer = gl.createRenderbuffer()!;
    this.buffer = gl.createBuffer()!;
    if (!this.fbo || !this.renderbuffer || !this.buffer) {
      this.dispose();
      throw new Error("Scope readback allocation failed");
    }
  }

  capture(done: (data: ScopePixels) => void, failed: () => void, target: RenderTarget = screenTarget(this.gl)) {
    if (this.disposed || this.fence) {
      failed();
      return;
    }
    const gl = this.gl;
    const start = performance.now();
    const size = sampleSize(target.width, target.height);
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    try {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
      if (this.width !== size.width || this.height !== size.height) {
        this.width = size.width;
        this.height = size.height;
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.renderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, this.width, this.height);
        gl.framebufferRenderbuffer(
          gl.DRAW_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.RENDERBUFFER,
          this.renderbuffer,
        );
        if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error("Scope framebuffer incomplete");
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.width * this.height * 4, gl.STREAM_READ);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
      gl.blitFramebuffer(
        0,
        0,
        target.width,
        target.height,
        0,
        0,
        this.width,
        this.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!this.fence) throw new Error("Scope fence unavailable");
      gl.flush();
    } catch {
      failed();
      return;
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    }
    const captureMs = performance.now() - start;
    let pollMs = 0;
    const poll = () => {
      if (this.disposed || !this.fence) return;
      const pollStart = performance.now();
      const status = gl.clientWaitSync(this.fence, 0, 0);
      pollMs += performance.now() - pollStart;
      if (status === gl.TIMEOUT_EXPIRED && performance.now() - start < 2000) {
        this.raf = requestAnimationFrame(poll);
        return;
      }
      gl.deleteSync(this.fence);
      this.fence = null;
      if (
        (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) ||
        gl.isContextLost()
      ) {
        failed();
        return;
      }
      const readStart = performance.now();
      const previous = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      const pixels =
        this.pixels?.byteLength === this.width * this.height * 4
          ? this.pixels
          : new Uint8ClampedArray(this.width * this.height * 4);
      this.pixels = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous);
      done({
        pixels,
        width: this.width,
        height: this.height,
        captureMs,
        readMs: performance.now() - readStart + pollMs,
      });
    };
    this.raf = requestAnimationFrame(poll);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const gl = this.gl;
    if (this.fence) gl.deleteSync(this.fence);
    gl.deleteBuffer(this.buffer);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteRenderbuffer(this.renderbuffer);
  }
}
