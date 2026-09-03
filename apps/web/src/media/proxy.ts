import { leaseMediaKey } from "@/persistence/media-gc";
import { acquireMediaUrl, writeMediaFile } from "@/persistence/opfs";
import { type MediaAsset, newId } from "@movie-desk/core";

// Generate a low-res proxy of a video asset. We re-encode via WebCodecs +
// mp4-muxer at a reduced resolution so the editor can scrub a lighter file.
// Falls back to null if WebCodecs / decode isn't available. Export always
// uses the original `opfsPath`, never the proxy.

const PROXY_WIDTH = 640;

const isSupported = () =>
  typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;

export interface ProxyResult {
  proxyPath: string;
  proxyWidth: number;
  proxyHeight: number;
  releaseLease: () => void;
}

export const generateProxy = async (
  asset: MediaAsset,
  onProgress?: (pct: number) => void,
): Promise<ProxyResult | null> => {
  if (!isSupported() || asset.kind !== "video") return null;
  const mediaLease = await acquireMediaUrl(asset.opfsPath);
  if (!mediaLease) return null;

  const video = document.createElement("video");
  let encoder: VideoEncoder | null = null;
  try {
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = mediaLease.url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
    });

    const aspect = video.videoHeight / video.videoWidth || 0.5625;
    const pw = Math.min(PROXY_WIDTH, video.videoWidth || PROXY_WIDTH);
    const ph = Math.round(pw * aspect);
    const fps = 24;
    const durationSec = video.duration || asset.durationMs / 1000;
    const totalFrames = Math.max(1, Math.floor(durationSec * fps));

    const { Mp4Writer } = await import("@/media/mux/mp4-writer");
    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d")!;

    const muxer = new Mp4Writer({
      video: { codec: "avc", width: pw, height: ph, frameRate: fps },
    });
    let encoderError: Error | null = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encoderError = error instanceof Error ? error : new Error(String(error));
      },
    });
    encoder.configure({
      codec: "avc1.42001f",
      width: pw,
      height: ph,
      bitrate: 1_500_000,
      framerate: fps,
    });

    const seek = (sec: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = sec;
      });

    for (let f = 0; f < totalFrames; f++) {
      await seek(f / fps);
      ctx.drawImage(video, 0, 0, pw, ph);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((f * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      try {
        encoder.encode(frame, { keyFrame: f % 48 === 0 });
      } finally {
        frame.close();
      }
      if (f % 8 === 0) onProgress?.(f / totalFrames);
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    const buffer = await muxer.finalize();
    onProgress?.(1);

    const blob = new Blob([buffer], { type: "video/mp4" });
    const proxyPath = `${newId()}__proxy.mp4`;
    const releaseLease = leaseMediaKey(proxyPath);
    try {
      await writeMediaFile(proxyPath, new File([blob], proxyPath, { type: "video/mp4" }));
      return { proxyPath, proxyWidth: pw, proxyHeight: ph, releaseLease };
    } catch (error) {
      releaseLease();
      throw error;
    }
  } finally {
    if (encoder?.state !== "closed") encoder?.close();
    video.pause();
    video.removeAttribute("src");
    video.load();
    mediaLease.release();
  }
};
