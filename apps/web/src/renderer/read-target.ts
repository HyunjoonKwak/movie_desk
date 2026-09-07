import type { GL } from "./gl";
import type { RenderTarget } from "./render-target";

// Default capture keeps the existing screen presentation boundary. Explicit
// target reads borrow only READ_FRAMEBUFFER and restore it on success/failure;
// DRAW_FRAMEBUFFER is untouched, so an interrupted compositor can resume.
export const readTargetPixels = (
  gl: GL,
  width: number,
  height: number,
  pixels: Uint8Array,
  target?: RenderTarget,
): void => {
  if (!target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return;
  }
  if (target.width !== width || target.height !== height)
    throw new Error("Capture target dimensions must match the output");
  const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
  }
};
