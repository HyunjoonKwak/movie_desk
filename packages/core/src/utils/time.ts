// Time units used across the engine.
// `Ms` = wall-clock milliseconds in the timeline.
// `Frame` = frame index at the project's framerate.

export type Ms = number;
export type Frame = number;
export type Fps = number;

export const msToFrames = (ms: Ms, fps: Fps): Frame => Math.round((ms * fps) / 1000);
export const framesToMs = (frame: Frame, fps: Fps): Ms => (frame * 1000) / fps;
export const snapMsToFrame = (ms: Ms, fps: Fps): Ms => framesToMs(msToFrames(ms, fps), fps);

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const formatTimecode = (ms: Ms, fps: Fps): string => {
  const totalFrames = Math.max(0, msToFrames(ms, fps));
  const f = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / Math.round(fps));
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};

/** Strict non-drop-frame timecode; actual frame duration always uses project fps. */
export const parseTimecode = (text: string, fps: Fps): Ms | null => {
  if (!Number.isFinite(fps) || fps < 1) return null;
  const match = /^(\d{2,}):(\d{2}):(\d{2}):(\d{2,})$/.exec(text.trim());
  if (!match) return null;
  const [h, m, s, f] = match.slice(1).map(Number) as [number, number, number, number];
  const nominal = Math.round(fps);
  if (m >= 60 || s >= 60 || f >= nominal) return null;
  const frames = ((h * 60 + m) * 60 + s) * nominal + f;
  return Number.isSafeInteger(frames) ? framesToMs(frames, fps) : null;
};
