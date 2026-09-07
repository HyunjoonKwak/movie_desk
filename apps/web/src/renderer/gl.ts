// Minimal WebGL2 helpers — texture, shader, FBO. No third-party dependency.

export type GL = WebGL2RenderingContext;

export const createGL = (canvas: HTMLCanvasElement): GL => {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("WebGL2 is required");
  if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "srgb";
  if ("unpackColorSpace" in gl) gl.unpackColorSpace = "srgb";
  return gl;
};

const compileShader = (gl: GL, type: number, source: string): WebGLShader => {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "(no log)";
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}`);
  }
  return sh;
};

export const linkProgram = (gl: GL, vsSrc: string, fsSrc: string): WebGLProgram => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "(no log)";
    gl.deleteProgram(prog);
    throw new Error(`Program link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
};

export const createTexture = (gl: GL): WebGLTexture => {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
};

// Upload any TexImageSource (HTMLVideoElement, HTMLImageElement, ImageBitmap,
// VideoFrame) into a texture. Returns the texture.
export const uploadSource = (
  gl: GL,
  tex: WebGLTexture,
  source: TexImageSource,
  premultiplied = true,
): WebGLTexture => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return tex;
};

// A reusable full-screen quad: positions in clip space + uvs.
export const createQuad = (gl: GL): { vao: WebGLVertexArrayObject; draw: () => void } => {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    // x, y, u, v
    new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
    ]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);
  return {
    vao,
    draw: () => {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
};

export interface TargetFormat {
  readonly internalFormat: number;
  readonly type: number;
  readonly precision: "half-float" | "srgb8";
}

// WebGL2 half-float textures support LINEAR filtering without OES_texture_float_linear.
// SRGB8_ALPHA8 attachments decode the destination before blending and encode writes.
// Their sampled values are linear too; no manual storage encode is applied twice.
export const probeColorTarget = (gl: GL): TargetFormat | null => {
  const oldFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const oldTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const candidates: TargetFormat[] = [];
  if (gl.getExtension("EXT_color_buffer_float")) {
    candidates.push({ internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT, precision: "half-float" });
  }
  candidates.push({ internalFormat: gl.SRGB8_ALPHA8, type: gl.UNSIGNED_BYTE, precision: "srgb8" });
  try {
    for (const format of candidates) {
      const tex = createTexture(gl);
      const fbo = gl.createFramebuffer();
      if (!fbo) {
        gl.deleteTexture(tex);
        continue;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, 2, 2, 0, gl.RGBA, format.type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      if (complete && verifyColorTarget(gl, format)) return format;
    }
    return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, oldFbo);
    gl.bindTexture(gl.TEXTURE_2D, oldTex);
  }
};

export const allocateTarget = (gl: GL, w: number, h: number, format?: TargetFormat) => {
  const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const tex = createTexture(gl);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    format?.internalFormat ?? gl.RGBA8,
    w,
    h,
    0,
    gl.RGBA,
    format?.type ?? gl.UNSIGNED_BYTE,
    null,
  );
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    throw new Error("createFramebuffer failed");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    throw new Error("Color target is not renderable");
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
  return { tex, fbo };
};

// Run on a fresh/restored compositor context. Probe storage encode, LINEAR
// sampling decode and destination blending together, not extension names alone.
const verifyColorTarget = (gl: GL, format: TargetFormat): boolean => {
  let scene: ReturnType<typeof allocateTarget> | undefined;
  let output: ReturnType<typeof allocateTarget> | undefined;
  let paint: WebGLProgram | undefined;
  let sample: WebGLProgram | undefined;
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const blending = gl.isEnabled(gl.BLEND);
  const srcRgb = gl.getParameter(gl.BLEND_SRC_RGB) as number;
  const dstRgb = gl.getParameter(gl.BLEND_DST_RGB) as number;
  const srcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
  const dstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA) as number;
  const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
  const vs = `#version 300 es
  void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  try {
    scene = allocateTarget(gl, 1, 1, format);
    output = allocateTarget(gl, 1, 1);
    paint = linkProgram(
      gl,
      vs,
      `#version 300 es
      precision highp float; out vec4 color; void main() { color = vec4(0.25, 0.25, 0.25, 0.5); }`,
    );
    sample = linkProgram(
      gl,
      vs,
      `#version 300 es
      precision highp float; uniform sampler2D tex; out vec4 color;
      void main() { color = texture(tex, vec2(0.5)); }`,
    );
    gl.viewport(0, 0, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(paint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.fbo);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.useProgram(sample);
    gl.uniform1i(
      gl.getUniformLocation(sample, "tex"),
      (gl.getParameter(gl.ACTIVE_TEXTURE) as number) - gl.TEXTURE0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const bytes = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return Math.abs(bytes[0]! - 96) <= 1 && Math.abs(bytes[3]! - 191) <= 1;
  } catch {
    return false;
  } finally {
    for (const target of [scene, output])
      if (target) {
        gl.deleteTexture(target.tex);
        gl.deleteFramebuffer(target.fbo);
      }
    if (paint) gl.deleteProgram(paint);
    if (sample) gl.deleteProgram(sample);
    gl.useProgram(program);
    gl.viewport(viewport[0]!, viewport[1]!, viewport[2]!, viewport[3]!);
    gl.clearColor(clear[0]!, clear[1]!, clear[2]!, clear[3]!);
    gl.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
    if (blending) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
  }
};
