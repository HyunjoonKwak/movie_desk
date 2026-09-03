import { waitForEncoderQueue } from "@/media/mux/encoder-backpressure";
import { resolveMediaSource } from "@/media/source/resolve-media-source";
import { leaseMediaKey } from "@/persistence/media-gc";
import { writeMediaFile } from "@/persistence/opfs";
import { streamFramesAt } from "@/renderer/frame-sampler";
import { type MediaAsset, newId } from "@movie-desk/core";

// Generate a low-res proxy of a video asset: one decode pass through the
// shared frame sampler (WebCodecs when the container allows, media-element
// seeks otherwise), then re-encoded through the shared MP4 writer at a reduced
// resolution so the editor can scrub a lighter file. The sampler applies the
// container rotation, so the proxy is stored upright. Falls back to null when
// WebCodecs encoding or decoding is unavailable. Export always uses the
// original `opfsPath`, never the proxy.

const PROXY_WIDTH = 640;
const PROXY_FPS = 24;

const isSupported = () =>
  typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;

export interface ProxyResult {
  proxyPath: string;
  proxyWidth: number;
  proxyHeight: number;
  releaseLease: () => void;
}

const proxySize = (sourceWidth: number, sourceHeight: number) => {
  const aspect = sourceHeight / sourceWidth || 0.5625;
  const width = Math.min(PROXY_WIDTH, sourceWidth || PROXY_WIDTH);
  // Encoders want even dimensions.
  const height = Math.max(2, Math.round((width * aspect) / 2) * 2);
  return { width, height };
};

export const generateProxy = async (
  asset: MediaAsset,
  onProgress?: (pct: number) => void,
): Promise<ProxyResult | null> => {
  if (!isSupported() || asset.kind !== "video") return null;
  const source = await resolveMediaSource(asset).catch(() => null);
  if (!source) return null;
  const durationMs = asset.durationMs;
  if (!(durationMs > 0)) return null;

  const { Mp4Writer } = await import("@/media/mux/mp4-writer");
  const totalFrames = Math.max(1, Math.floor((durationMs / 1000) * PROXY_FPS));
  const times = Array.from({ length: totalFrames }, (_, f) => (f * 1000) / PROXY_FPS);

  let encoder: VideoEncoder | null = null;
  let muxer: InstanceType<typeof Mp4Writer> | null = null;
  let encoderError: Error | null = null;
  let size: { width: number; height: number } | null = null;
  let encoded = 0;
  try {
    await streamFramesAt(
      source,
      times,
      {
        size: (w, h) => {
          size ??= proxySize(w, h);
          return size;
        },
        ...(asset.rotation ? { rotation: asset.rotation } : {}),
        onProgress: (done, total) => {
          if (done % 8 === 0) onProgress?.(done / total);
        },
      },
      async ({ image }) => {
        if (encoderError) throw encoderError;
        if (!encoder || !muxer) {
          const dims = size ?? proxySize(image.width, image.height);
          muxer = new Mp4Writer({
            video: { codec: "avc", width: dims.width, height: dims.height, frameRate: PROXY_FPS },
          });
          const writer = muxer;
          encoder = new VideoEncoder({
            output: (chunk, meta) => writer.addVideoChunk(chunk, meta),
            error: (error) => {
              encoderError = error instanceof Error ? error : new Error(String(error));
            },
          });
          encoder.configure({
            codec: "avc1.42001f",
            width: dims.width,
            height: dims.height,
            bitrate: 1_500_000,
            framerate: PROXY_FPS,
          });
        }
        const frame = new VideoFrame(image.data, {
          format: "RGBA",
          codedWidth: image.width,
          codedHeight: image.height,
          timestamp: Math.round((encoded * 1_000_000) / PROXY_FPS),
          duration: Math.round(1_000_000 / PROXY_FPS),
        });
        try {
          encoder.encode(frame, { keyFrame: encoded % 48 === 0 });
        } finally {
          frame.close();
        }
        encoded += 1;
        await waitForEncoderQueue(encoder);
      },
    );
    if (!encoder || !muxer || encoded === 0) return null;
    await (encoder as VideoEncoder).flush();
    if (encoderError) throw encoderError;
    const buffer = await (muxer as InstanceType<typeof Mp4Writer>).finalize();
    onProgress?.(1);

    const dims = size ?? proxySize(PROXY_WIDTH, PROXY_WIDTH * 0.5625);
    const blob = new Blob([buffer], { type: "video/mp4" });
    const proxyPath = `${newId()}__proxy.mp4`;
    const releaseLease = leaseMediaKey(proxyPath);
    try {
      await writeMediaFile(proxyPath, new File([blob], proxyPath, { type: "video/mp4" }));
      return { proxyPath, proxyWidth: dims.width, proxyHeight: dims.height, releaseLease };
    } catch (error) {
      releaseLease();
      throw error;
    }
  } finally {
    const open = encoder as VideoEncoder | null;
    if (open && open.state !== "closed") open.close();
  }
};
