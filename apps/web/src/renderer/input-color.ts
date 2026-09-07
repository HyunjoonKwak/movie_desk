import { type ColorDomain, decodeTransfer, encodeTransfer } from "./color";
import { type GL, createTexture, uploadSource } from "./gl";
export type TransferProbe = "preserved" | "converted-to-srgb" | "unknown";
export const PROBE_RGB = [180, 100, 60] as const;
export const classifyTransferProbe = (rgb: readonly number[]): TransferProbe => {
  if (rgb.length < 3 || rgb.some((x) => !Number.isFinite(x))) return "unknown";
  const converted = PROBE_RGB.map(
    (x) => 255 * encodeTransfer(decodeTransfer(x / 255, "bt709"), "srgb"),
  );
  const near = (expected: readonly number[]) =>
    expected.every((x, i) => Math.abs(x - rgb[i]!) <= 1.5);
  if (near(PROBE_RGB)) return "preserved";
  if (near(converted)) return "converted-to-srgb";
  return "unknown";
};

// Probe the actual upload API on this GL context instead of assuming all browser
// engines normalize the BT.709 transfer. Repeat with every restored context.
export const probeVideoTransfer = (gl: GL): TransferProbe => {
  if (typeof VideoFrame === "undefined") return "unknown";
  const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  let tex: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let frame: VideoFrame | null = null;
  try {
    frame = new VideoFrame(new Uint8Array([...PROBE_RGB, 255]), {
      format: "RGBA",
      codedWidth: 1,
      codedHeight: 1,
      timestamp: 0,
      colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "rgb", fullRange: true },
    });
    tex = createTexture(gl);
    uploadSource(gl, tex, frame, false);
    fbo = gl.createFramebuffer();
    if (!fbo) return "unknown";
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return "unknown";
    const bytes = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return classifyTransferProbe([...bytes.slice(0, 3)]);
  } catch {
    return "unknown";
  } finally {
    frame?.close();
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  }
};

export const uploadedVideoDomain = (
  color: VideoColorSpaceInit,
  probe: TransferProbe,
): { domain: ColorDomain; approximate: boolean } => {
  if (color.transfer === "bt709" && color.primaries === "bt709" && probe !== "unknown") {
    return { domain: probe === "preserved" ? "bt709" : "srgb", approximate: false };
  }
  if (
    color.transfer === "iec61966-2-1" &&
    ["bt709", "smpte432"].includes(String(color.primaries))
  ) {
    return { domain: "srgb", approximate: false };
  }
  // Unknown probe/tags and unsupported HDR/gamut combinations use an explicit,
  // user-visible browser SDR approximation. Never apply an unverified transform.
  return { domain: "srgb", approximate: true };
};
