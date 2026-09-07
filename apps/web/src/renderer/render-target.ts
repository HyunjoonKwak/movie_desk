import type { GL } from "./gl";

// Presentation attachments contain premultiplied sRGB, like the canvas.
// Child targets start transparent so uncovered pixels preserve their parent's
// backdrop. The root canvas remains opaque black for preview/export parity.
export interface RenderTarget {
  readonly fbo: WebGLFramebuffer | null;
  readonly width: number;
  readonly height: number;
  readonly clearAlpha: 0 | 1;
}

export interface TargetLease extends RenderTarget {
  readonly tex: WebGLTexture;
  release(): void;
}

export const screenTarget = (gl: GL): RenderTarget => ({
  fbo: null,
  width: gl.drawingBufferWidth,
  height: gl.drawingBufferHeight,
  clearAlpha: 1,
});

// WebGL2 has independent read/draw bindings. Restoring FRAMEBUFFER alone loses
// a caller's split binding, including an export readback in progress.
export const preserveFramebuffer = (gl: GL): (() => void) => {
  const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  return () => {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.viewport(viewport[0]!, viewport[1]!, viewport[2]!, viewport[3]!);
  };
};
