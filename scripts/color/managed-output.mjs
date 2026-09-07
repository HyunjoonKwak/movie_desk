import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const {
  Output,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
  Mp4OutputFormat,
} = require("mediabunny");
const compile = (file) =>
  ts.transpileModule(
    readFileSync(new URL(`../../apps/web/src/${file}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
const server = createServer((_, res) =>
  res.end("<!doctype html><title>BT.709 export audit</title>"),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(
    async ({ colorJs, frameJs, presetsJs }) => {
      const color = {};
      new Function("exports", colorJs)(color);
      const frameModule = {};
      new Function("exports", "require", frameJs)(frameModule, () => color);
      const presets = {};
      new Function("exports", presetsJs)(presets);
      const rows = [];
      for (const preset of presets.PRESETS) {
        const { width, height } = preset;
        const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
        const codec =
          preset.videoCodec === "vp9"
            ? "vp09.00.10.08"
            : `avc1.4200${blocks > 8192 ? "33" : blocks > 5120 ? "2A" : "1F"}`;
        const config = {
          codec,
          width,
          height,
          bitrate: preset.videoBitrateKbps * 1000,
          framerate: preset.fps,
        };
        const support = await VideoEncoder.isConfigSupported(config).catch(() => ({
          supported: false,
        }));
        if (!support.supported) {
          rows.push({ preset: preset.id, width, height, status: "unsupported encoder" });
          continue;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
        const capture = new frameModule.Bt709FrameCapture(canvas);
        const packets = [];
        let decoderConfig;
        let failure;
        const encoder = new VideoEncoder({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            packets.push({
              data: [...data],
              type: chunk.type,
              timestamp: chunk.timestamp,
              duration: chunk.duration ?? 33333,
            });
            if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
          },
          error: (e) => {
            failure = String(e);
          },
        });
        try {
          encoder.configure(config);
          gl.clearColor(118 / 255, 118 / 255, 118 / 255, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const at = performance.now();
          const frame = capture.capture(0, 33333);
          const captureMs = performance.now() - at;
          const inputColor = frame.colorSpace.toJSON();
          encoder.encode(frame, { keyFrame: true });
          frame.close();
          await encoder.flush();
          if (failure || !decoderConfig) throw new Error(failure ?? "No decoder config");
          const decoded = [];
          const reads = [];
          const decoder = new VideoDecoder({
            output: (output) => {
              reads.push(
                (async () => {
                  try {
                    const bytes = new Uint8Array(output.allocationSize());
                    const layout = await output.copyTo(bytes);
                    decoded.push({
                      colorSpace: output.colorSpace.toJSON(),
                      format: output.format,
                      centerY:
                        bytes[
                          layout[0].offset +
                            Math.floor(height / 2) * layout[0].stride +
                            Math.floor(width / 2)
                        ],
                    });
                  } finally {
                    output.close();
                  }
                })(),
              );
            },
            error: (e) => {
              failure = String(e);
            },
          });
          try {
            // Do not supply colorSpace: require the decoder to read the bitstream.
            const { colorSpace: ignored, ...bitstreamConfig } = decoderConfig;
            decoder.configure(bitstreamConfig);
            for (const packet of packets)
              decoder.decode(
                new EncodedVideoChunk({ ...packet, data: new Uint8Array(packet.data) }),
              );
            await decoder.flush();
            await Promise.all(reads);
          } finally {
            decoder.close();
          }
          if (failure) throw new Error(failure);
          rows.push({
            preset: preset.id,
            width,
            height,
            status: "encoded",
            captureMs,
            inputColor,
            decoderConfig: {
              ...decoderConfig,
              description: decoderConfig.description
                ? [...new Uint8Array(decoderConfig.description)]
                : undefined,
            },
            decoded,
            packets,
          });
        } catch (error) {
          rows.push({
            preset: preset.id,
            width,
            height,
            status: "unsupported output",
            reason: String(error),
          });
        } finally {
          if (encoder.state !== "closed") encoder.close();
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
      }
      const performanceRows = [];
      for (const managed of [false, true]) {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const gl = canvas.getContext("webgl2", { antialias: false });
        const capture = new frameModule.Bt709FrameCapture(canvas);
        const encoder = new VideoEncoder({
          output() {},
          error(error) {
            throw error;
          },
        });
        encoder.configure({
          codec: "vp09.00.10.08",
          width: 1920,
          height: 1080,
          bitrate: 6e6,
          framerate: 30,
        });
        const at = performance.now();
        for (let i = 0; i < 30; i++) {
          gl.clearColor(118 / 255, 118 / 255, 118 / 255, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const frame = managed
            ? capture.capture(i * 33333, 33333)
            : new VideoFrame(canvas, { timestamp: i * 33333, duration: 33333 });
          encoder.encode(frame, { keyFrame: i === 0 });
          frame.close();
          if (encoder.encodeQueueSize > 4)
            await new Promise((resolve) =>
              encoder.addEventListener("dequeue", resolve, { once: true }),
            );
        }
        await encoder.flush();
        encoder.close();
        performanceRows.push({
          managed,
          frames: 30,
          width: 1920,
          height: 1080,
          totalMs: performance.now() - at,
        });
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      return { rows, performanceRows };
    },
    {
      colorJs: compile("renderer/color"),
      frameJs: compile("export/bt709-frame"),
      presetsJs: compile("export/presets"),
    },
  );
  for (const row of results.rows) {
    if (row.status !== "encoded") continue;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const source = new EncodedVideoPacketSource(
      row.decoderConfig.codec.startsWith("vp09") ? "vp9" : "avc",
    );
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    for (const [i, p] of row.packets.entries()) {
      const config = {
        ...row.decoderConfig,
        ...(row.decoderConfig.description
          ? { description: new Uint8Array(row.decoderConfig.description) }
          : {}),
      };
      await source.add(
        new EncodedPacket(new Uint8Array(p.data), p.type, p.timestamp / 1e6, p.duration / 1e6),
        i === 0 ? { decoderConfig: config } : undefined,
      );
    }
    await output.finalize();
    const bytes = Buffer.from(target.buffer);
    const pos = bytes.indexOf("colr");
    row.container =
      pos < 0
        ? null
        : {
            primaries: bytes.readUInt16BE(pos + 8),
            transfer: bytes.readUInt16BE(pos + 10),
            matrix: bytes.readUInt16BE(pos + 12),
            fullRange: !!(bytes[pos + 14] & 128),
          };
    row.bytes = bytes.length;
    row.packets = undefined;
    if (
      row.container?.primaries !== 1 ||
      row.container?.transfer !== 1 ||
      row.container?.matrix !== 1 ||
      row.container?.fullRange !== false
    )
      throw new Error(`${row.preset}: tags mismatch`);
    if (
      !row.decoded.length ||
      row.decoded.some(
        (d) =>
          d.colorSpace.matrix !== "bt709" ||
          d.colorSpace.transfer !== "bt709" ||
          d.colorSpace.primaries !== "bt709" ||
          d.colorSpace.fullRange !== false ||
          Math.abs(d.centerY - 106) > 2,
      )
    )
      throw new Error(`${row.preset}: bitstream signal mismatch`);
  }
  writeFileSync(
    new URL("../../docs/evaluations/2026-09-07-color-managed-output.json", import.meta.url),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI audit summary.
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
