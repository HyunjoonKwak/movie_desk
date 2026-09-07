import { writeFileSync } from "node:fs";
// Offline WebCodecs -> pinned Mediabunny muxing, matching exporter metadata forwarding.
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const {
  Output,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
  Mp4OutputFormat,
} = require("mediabunny");
const server = createServer((_, res) => res.end("<!doctype html><title>Local color audit</title>"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    gl.clearColor(0.5, 0.5, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const packets = [];
    const metadata = [];
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        packets.push({
          data: Array.from(data),
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
        });
        if (meta.decoderConfig)
          metadata.push({
            ...meta.decoderConfig,
            description: meta.decoderConfig.description
              ? Array.from(new Uint8Array(meta.decoderConfig.description))
              : undefined,
          });
      },
      error: (e) => {
        throw e;
      },
    });
    encoder.configure({
      codec: "vp09.00.10.08",
      width: 256,
      height: 144,
      bitrate: 1_000_000,
      framerate: 30,
    });
    const frame = new VideoFrame(canvas, { timestamp: 0, duration: 33333 });
    const frameColor = frame.colorSpace.toJSON();
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();
    const inputUploads = [];
    for (const [name, colorSpace] of Object.entries({
      srgb: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
      rec709: { primaries: "bt709", transfer: "bt709", matrix: "rgb", fullRange: true },
      p3: { primaries: "smpte432", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
    })) {
      const frame = new VideoFrame(new Uint8Array([180, 100, 60, 255]), {
        format: "RGBA",
        codedWidth: 1,
        codedHeight: 1,
        timestamp: 0,
        colorSpace,
      });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const rgba = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      inputUploads.push({
        name,
        tags: frame.colorSpace.toJSON(),
        uploaded: Array.from(rgba),
        glError: gl.getError(),
      });
      frame.close();
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
    }
    return { packets, metadata, frameColor, inputUploads };
  });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new EncodedVideoPacketSource("vp9");
  output.addVideoTrack(source, { frameRate: 30 });
  await output.start();
  for (const [i, p] of encoded.packets.entries()) {
    const cfg = encoded.metadata[0];
    await source.add(
      new EncodedPacket(new Uint8Array(p.data), p.type, p.timestamp / 1e6, p.duration / 1e6),
      i === 0
        ? {
            decoderConfig: {
              ...cfg,
              ...(cfg.description ? { description: new Uint8Array(cfg.description) } : {}),
            },
          }
        : undefined,
    );
  }
  await output.finalize();
  const bytes = Buffer.from(target.buffer);
  const pos = bytes.indexOf("colr");
  const tags =
    pos < 0
      ? null
      : {
          type: bytes.toString("ascii", pos + 4, pos + 8),
          primaries: bytes.readUInt16BE(pos + 8),
          transfer: bytes.readUInt16BE(pos + 10),
          matrix: bytes.readUInt16BE(pos + 12),
          fullRange: !!(bytes[pos + 14] & 128),
        };
  const result = {
    inputUploads: encoded.inputUploads,
    frameColor: encoded.frameColor,
    encoderConfig: encoded.metadata,
    colrCount: pos < 0 ? 0 : 1,
    tags,
    bytes: bytes.length,
    note: "One real VP9 encoded WebGL canvas frame; same VideoFrame options and unchanged encoder metadata forwarding as exporter. Not H264/HDR validation.",
  };
  writeFileSync(
    new URL("../../docs/evaluations/2026-09-07-color-output-tags.json", import.meta.url),
    `${JSON.stringify(result, null, 2)}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
