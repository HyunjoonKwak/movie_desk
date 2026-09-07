import type { GL } from "./gl";
import { type TargetFormat, allocateTarget } from "./gl";

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

// Ping-pong framebuffers for multi-pass effect chains. Allocates two
// offscreen RGBA textures and an FBO each, sized to the canvas viewport.
export class PingPong {
  private a: Target | null = null;
  private b: Target | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly gl: GL,
    private readonly format?: TargetFormat,
  ) {}

  resize(w: number, h: number) {
    if (w === this.width && h === this.height && this.a && this.b) return;
    this.width = w;
    this.height = h;
    this.dispose();
    this.a = this.allocTarget(w, h);
    this.b = this.allocTarget(w, h);
  }

  private allocTarget(w: number, h: number): Target {
    return allocateTarget(this.gl, w, h, this.format);
  }

  // Returns [src, dst] for the next pass, then call .swap()
  current(): [Target, Target] {
    if (!this.a || !this.b) throw new Error("PingPong not initialized");
    return [this.a, this.b];
  }

  swap() {
    const tmp = this.a;
    this.a = this.b;
    this.b = tmp;
  }

  size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  dispose() {
    const gl = this.gl;
    if (this.a) {
      gl.deleteFramebuffer(this.a.fbo);
      gl.deleteTexture(this.a.tex);
    }
    if (this.b) {
      gl.deleteFramebuffer(this.b.fbo);
      gl.deleteTexture(this.b.tex);
    }
    this.a = null;
    this.b = null;
  }
}
