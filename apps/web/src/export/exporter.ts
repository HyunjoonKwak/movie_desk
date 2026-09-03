import { Compositor } from "@/renderer/compositor";
import { useRangeStore } from "@/stores/range-store";
import { type Project, framesToMs, msToFrames } from "@movie-desk/core";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { ProjectAudioMixer, packStereoPlanar } from "./audio-mixer";
import { useDuckingStore } from "./ducking-store";
import { LoudnessMeter } from "./loudness";
import { useNormalizeStore } from "./normalize-store";
import type { ExportPreset, ExportProgress, ExportRequest, ExportResult, Exporter } from "./types";

const isWebCodecsSupported = (): boolean =>
  typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;

// Renders project frames offscreen via the existing Compositor, encodes each
// frame with WebCodecs VideoEncoder, mixes audio across all unmuted clips,
// and muxes both into an MP4 (H.264 + AAC) or WebM.
// Thrown when the user cancels; the dialog reports it as a cancel, not a failure.
export class ExportCancelledError extends Error {
  constructor(options?: ErrorOptions) {
    super("Export cancelled", options);
    this.name = "ExportCancelledError";
  }
}

// AudioEncoder existing doesn't mean it can do AAC: Chromium builds without
// platform or proprietary codecs expose the API but reject mp4a.40.2. Ask
// first, so such builds still get a video-only file instead of a failed export.
export const aacEncoderSupported = async (bitrateKbps: number): Promise<boolean> => {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2",
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: bitrateKbps * 1000,
    });
    return support.supported === true;
  } catch {
    return false;
  }
};

const MAX_ENCODE_QUEUE = 8;

const waitForEncoderQueue = async (encoder: VideoEncoder, limit: number): Promise<void> => {
  while (encoder.encodeQueueSize > limit && encoder.state === "configured") {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 50);
      function done() {
        clearTimeout(timer);
        encoder.removeEventListener("dequeue", done);
        resolve();
      }
      encoder.addEventListener("dequeue", done, { once: true });
    });
  }
};

export class WebCodecsExporter implements Exporter {
  private cancelled = false;
  private abortController: AbortController | null = null;
  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  async start(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
    if (!isWebCodecsSupported()) {
      throw new Error(
        "Video export needs the WebCodecs API, which this browser doesn't support. " +
          "Try the latest Chrome or Edge, or Safari 17+.",
      );
    }
    this.cancelled = false;
    const abortController = new AbortController();
    this.abortController = abortController;

    const { project, getAsset } = await this.resolveProject(req.projectId);
    const preset = req.preset;
    // Optional in/out work area limits export to a sub-range of the timeline.
    const range = useRangeStore.getState();
    const rangeStart = range.inMs ?? 0;
    const rangeEnd = range.outMs ?? project.timeline.duration;
    const exportDurationMs = Math.max(1, rangeEnd - rangeStart);
    const totalFrames = Math.max(1, msToFrames(exportDurationMs, preset.fps));

    onProgress({ stage: "preparing", progress: 0 });

    const canvas = document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    const compositor = new Compositor(canvas);
    let encoder: VideoEncoder | null = null;
    try {
      compositor.resize(preset.width, preset.height);
      let virtualPlayheadMs = 0;
      compositor.setPlayheadGetter(() => virtualPlayheadMs);

      // Include audio only when the preset wants AAC AND the browser can encode
      // it. A browser without an AAC encoder (older Safari, codec-less
      // Chromium) degrades to a video-only export instead of failing the render.
      const includeAudio =
        preset.container === "mp4" &&
        preset.audioCodec === "aac" &&
        (await aacEncoderSupported(preset.audioBitrateKbps));

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: codecForMuxer(preset.videoCodec),
          width: preset.width,
          height: preset.height,
          frameRate: preset.fps,
        },
        ...(includeAudio
          ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: 48_000 } }
          : {}),
        fastStart: "in-memory",
        firstTimestampBehavior: "offset",
      });

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          // biome-ignore lint/suspicious/noConsole: WebCodecs reports encoder failures via callbacks.
          console.error("Encoder error:", e);
        },
      });
      encoder.configure({
        codec: codecForEncoder(preset.videoCodec, preset.width, preset.height),
        width: preset.width,
        height: preset.height,
        bitrate: preset.videoBitrateKbps * 1000,
        framerate: preset.fps,
      });

      onProgress({ stage: "rendering", progress: 0 });
      const renderStartedAt = performance.now();

      for (let f = 0; f < totalFrames; f++) {
        if (this.cancelled) {
          throw new ExportCancelledError();
        }
        virtualPlayheadMs = rangeStart + framesToMs(f, preset.fps);
        // renderFrame keys off project.timeline.playhead for visibility, keyframes
        // and transitions, so advance it per frame (immutably) for the export.
        const frameProject = {
          ...project,
          timeline: { ...project.timeline, playhead: virtualPlayheadMs },
        };
        await compositor.renderFrame(frameProject, getAsset);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((f * 1_000_000) / preset.fps),
          duration: Math.round(1_000_000 / preset.fps),
        });
        try {
          encoder.encode(frame, { keyFrame: f % 60 === 0 });
        } finally {
          frame.close();
        }
        // Rendering outruns a software encoder many times over; without this
        // every pending 1080p frame sits in memory and "rendering 99%" hides
        // the real progress. Let the queue drain before decoding more.
        await waitForEncoderQueue(encoder, MAX_ENCODE_QUEUE);
        if (f % 5 === 0) {
          const elapsedSec = (performance.now() - renderStartedAt) / 1000;
          const realisedFps = f / Math.max(0.01, elapsedSec);
          const remainingSec = (totalFrames - f) / Math.max(0.5, realisedFps);
          onProgress({
            stage: "rendering",
            progress: f / totalFrames,
            fps: realisedFps,
            etaSeconds: remainingSec,
          });
        }
      }

      if (includeAudio) {
        const duck = useDuckingStore.getState();
        const mixer = new ProjectAudioMixer(project, getAsset, {
          enabled: duck.enabled,
          amountDb: duck.amountDb,
          thresholdDb: duck.thresholdDb,
        });
        try {
          const mixOptions = {
            startMs: rangeStart,
            endMs: rangeEnd,
            signal: abortController.signal,
          } as const;
          const normalize = useNormalizeStore.getState();
          let masterGain = 1;
          if (normalize.enabled) {
            const meter = new LoudnessMeter(mixer.sampleRate, 2);
            for await (const chunk of mixer.chunks(mixOptions)) meter.push(chunk.channels);
            const { integratedLufs } = meter.result();
            if (Number.isFinite(integratedLufs)) {
              masterGain = 10 ** ((normalize.targetLufs - integratedLufs) / 20);
              if (Math.abs(masterGain - 1) <= 0.01) masterGain = 1;
            }
          }

          const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (error) => {
              // biome-ignore lint/suspicious/noConsole: WebCodecs reports encoder failures via callbacks.
              console.warn("Audio encoder error:", error);
            },
          });
          try {
            audioEncoder.configure({
              codec: "mp4a.40.2",
              sampleRate: mixer.sampleRate,
              numberOfChannels: 2,
              bitrate: preset.audioBitrateKbps * 1000,
            });
            const encoderChunkSize = 1024;
            for await (const chunk of mixer.chunks(mixOptions)) {
              const totalSamples = Math.min(chunk.channels[0].length, chunk.channels[1].length);
              for (let i = 0; i < totalSamples; i += encoderChunkSize) {
                if (this.cancelled) throw new ExportCancelledError();
                const numberOfFrames = Math.min(encoderChunkSize, totalSamples - i);
                const planar = packStereoPlanar(chunk.channels, i, numberOfFrames);
                if (masterGain !== 1) {
                  for (let sample = 0; sample < planar.length; sample++) {
                    planar[sample] = Math.max(-1, Math.min(1, planar[sample]! * masterGain));
                  }
                }
                const data = new AudioData({
                  format: "f32-planar",
                  sampleRate: chunk.sampleRate,
                  numberOfFrames,
                  numberOfChannels: 2,
                  timestamp: Math.round(((chunk.startSample + i) / chunk.sampleRate) * 1_000_000),
                  data: planar,
                });
                try {
                  audioEncoder.encode(data);
                } finally {
                  data.close();
                }
              }
            }
            await audioEncoder.flush();
          } finally {
            if (audioEncoder.state !== "closed") audioEncoder.close();
          }
        } catch (err) {
          if (this.cancelled || abortController.signal.aborted) {
            throw new ExportCancelledError({ cause: err });
          }
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Audio export failed: ${message}`, { cause: err });
        } finally {
          mixer.dispose();
        }
      }

      if (this.cancelled) throw new ExportCancelledError();
      onProgress({ stage: "muxing", progress: 0.95 });
      await encoder.flush();
      muxer.finalize();

      const { buffer } = muxer.target;
      onProgress({ stage: "finalizing", progress: 1 });

      const name = sanitizeName(project.name) || "export";
      return {
        blob: new Blob([buffer], { type: "video/mp4" }),
        mime: "video/mp4",
        suggestedName: `${name}.mp4`,
      };
    } finally {
      if (this.abortController === abortController) this.abortController = null;
      if (encoder?.state !== "closed") encoder?.close();
      compositor.dispose();
    }
  }

  private async resolveProject(_projectId: string): Promise<{
    project: Project;
    getAsset: (
      id: import("@movie-desk/core").ID,
    ) => import("@movie-desk/core").MediaAsset | undefined;
  }> {
    const { useProjectStore } = await import("@/stores/project-store");
    const project = useProjectStore.getState().project;
    const assets = new Map(project.mediaLibrary.map((a) => [a.id, a]));
    return { project, getAsset: (id) => assets.get(id) };
  }
}

const codecForEncoder = (
  codec: ExportPreset["videoCodec"],
  width = 1920,
  height = 1080,
): string => {
  switch (codec) {
    case "h264": {
      const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
      const level = macroblocks > 8192 ? "33" : macroblocks > 5120 ? "2A" : "1F";
      return `avc1.4200${level}`;
    }
    case "vp9":
      return "vp09.00.10.08";
    case "av1":
      return "av01.0.04M.08";
  }
};

const codecForMuxer = (codec: ExportPreset["videoCodec"]): "avc" | "vp9" | "av1" => {
  switch (codec) {
    case "h264":
      return "avc";
    case "vp9":
      return "vp9";
    case "av1":
      return "av1";
  }
};

const sanitizeName = (s: string): string => s.replace(/[^a-z0-9_\-]+/gi, "_").slice(0, 60);

// Saves the encoded blob. In the desktop bundle we route through the
// Electron preload bridge (native Save panel + filesystem write); on the
// web we fall back to the standard anchor-download flow.
export const downloadBlob = async (blob: Blob, filename: string): Promise<void> => {
  const desktop =
    typeof window !== "undefined"
      ? (
          window as unknown as {
            cutDesktop?: {
              saveExport?: (p: {
                suggestedName: string;
                bytes: Uint8Array;
                mimeType?: string;
              }) => Promise<string | null>;
            };
          }
        ).cutDesktop
      : undefined;
  if (desktop?.saveExport) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await desktop.saveExport({
      suggestedName: filename,
      bytes,
      ...(blob.type ? { mimeType: blob.type } : {}),
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
