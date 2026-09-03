import { Mp4Writer } from "@/media/mux/mp4-writer";
import { newId, type MediaAsset } from "@movie-desk/core";
import { writeMediaFile } from "@/persistence/opfs";
import { leaseMediaKey } from "@/persistence/media-gc";
import type { TravelMove } from "./story";

// 이동 감지 → 맵 트랜지션 클립 (설계 §위치 4). Stylised dark chart — graticule
// grid + great-circle-flavoured route + moving marker — rendered to canvas and
// encoded through WebCodecs into a regular media asset. No tiles, no network,
// no new clip kind. Place labels are gazetteer-level (city), which doubles as
// the home-privacy generalisation.

const W = 1280;
const H = 720;
const FPS = 30;
const DUR_MS = 2400;

const project = (
  lat: number,
  lon: number,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
): { x: number; y: number } => {
  const padX = W * 0.22;
  const padY = H * 0.3;
  const sx = (lon - bounds.minLon) / Math.max(0.0001, bounds.maxLon - bounds.minLon);
  const sy = (lat - bounds.minLat) / Math.max(0.0001, bounds.maxLat - bounds.minLat);
  return { x: padX + sx * (W - padX * 2), y: H - padY - sy * (H - padY * 2) };
};

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  move: TravelMove,
  t: number, // 0..1 animation progress
): void => {
  const { from, to } = move;
  const bounds = {
    minLat: Math.min(from.lat!, to.lat!),
    maxLat: Math.max(from.lat!, to.lat!),
    minLon: Math.min(from.lon!, to.lon!),
    maxLon: Math.max(from.lon!, to.lon!),
  };
  // background
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, W, H);
  // graticule
  ctx.strokeStyle = "rgba(154,167,180,0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const a = project(from.lat!, from.lon!, bounds);
  const b = project(to.lat!, to.lon!, bounds);
  // curved route (quadratic, perpendicular bulge)
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const cx = mx - (dy / len) * len * 0.22;
  const cy = my + (dx / len) * len * 0.22;

  const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const bez = (p: number) => {
    const u = 1 - p;
    return {
      x: u * u * a.x + 2 * u * p * cx + p * p * b.x,
      y: u * u * a.y + 2 * u * p * cy + p * p * b.y,
    };
  };

  // full path (dim), progressed path (accent)
  ctx.strokeStyle = "rgba(56,208,196,0.25)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(cx, cy, b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#38d0c4";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  const steps = Math.max(2, Math.floor(60 * ease));
  for (let i = 1; i <= steps; i++) {
    const p = bez((i / 60) * Math.min(1, ease * 60 / steps));
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // endpoints
  for (const [pt, label] of [
    [a, move.from.label.split("— ")[1] ?? move.from.label],
    [b, move.to.label.split("— ")[1] ?? move.to.label],
  ] as const) {
    ctx.fillStyle = "#e8eef5";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillStyle = "#e8eef5";
    ctx.textAlign = "center";
    ctx.fillText(String(label), pt.x, pt.y - 20);
  }

  // moving marker
  const m = bez(ease);
  ctx.fillStyle = "#38d0c4";
  ctx.beginPath();
  ctx.arc(m.x, m.y, 10, 0, Math.PI * 2);
  ctx.fill();

  // caption
  ctx.font = "500 26px system-ui, sans-serif";
  ctx.fillStyle = "rgba(232,238,245,0.75)";
  ctx.textAlign = "center";
  ctx.fillText(move.label, W / 2, H - 56);
};

// Render + encode one move into an OPFS-backed media asset. Returns null when
// WebCodecs is unavailable or coordinates are missing — callers simply skip
// the transition (graceful, per design).
export const generateMapTransitionAsset = async (move: TravelMove): Promise<MediaAsset | null> => {
  if (typeof VideoEncoder === "undefined") return null;
  if (move.from.lat === undefined || move.to.lat === undefined) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const muxer = new Mp4Writer({
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: () => {},
    });
    encoder.configure({
      codec: "avc1.42E01F",
      width: W,
      height: H,
      bitrate: 4_000_000,
      framerate: FPS,
    });

    const frames = Math.round((DUR_MS / 1000) * FPS);
    for (let i = 0; i < frames; i++) {
      drawFrame(ctx, move, i / (frames - 1));
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i / FPS) * 1_000_000),
        duration: Math.round(1_000_000 / FPS),
      });
      encoder.encode(frame, { keyFrame: i % 30 === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();
    const buffer = await muxer.finalize();

    const blob = new Blob([buffer], { type: "video/mp4" });
    const id = newId();
    const name = `map-${(move.label.split(" · ")[0] ?? "route").replace(/\s+/g, "")}.mp4`;
    const opfsPath = `${id}__${name}`;
    const release = leaseMediaKey(opfsPath);
    try {
      await writeMediaFile(opfsPath, new File([blob], name, { type: "video/mp4" }));
      const thumb = canvas.toDataURL("image/jpeg", 0.6);
      return {
        id,
        name,
        kind: "video",
        mime: "video/mp4",
        durationMs: DUR_MS,
        width: W,
        height: H,
        opfsPath,
        sizeBytes: blob.size,
        thumbDataUrl: thumb,
        importedAt: Date.now(),
        capturedAt: move.to.startAt - 1, // sits just before the destination event
      };
    } finally {
      // Lease is released by the caller AFTER the asset lands in the project.
      setTimeout(release, 30_000);
    }
  } catch {
    return null;
  }
};
