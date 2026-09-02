// Display rotation carried by a container (QuickTime/MP4 `tkhd` matrix,
// what an iPhone writes for portrait footage). Decoders hand back the
// unrotated frame; this is the clockwise angle it must turn on screen.

export type SourceRotation = 0 | 90 | 180 | 270;

const FIXED_ONE = 65536; // 16.16 fixed point

// tkhd matrix layout: [a b u c d v x y w]. The rotation is atan2(c, a)
// counter-clockwise (ffmpeg's convention); the display needs the inverse.
export const rotationFromMatrix = (matrix: ArrayLike<number>): SourceRotation | null => {
  if (matrix.length < 5) return null;
  const a = (matrix[0] ?? 0) / FIXED_ONE;
  const b = (matrix[1] ?? 0) / FIXED_ONE;
  const c = (matrix[3] ?? 0) / FIXED_ONE;
  const d = (matrix[4] ?? 0) / FIXED_ONE;
  const scale = Math.hypot(a, b);
  if (scale === 0 || !Number.isFinite(scale)) return null;
  // A pure rotation (possibly scaled) has orthogonal rows of equal length.
  if (Math.abs(a * c + b * d) > 1e-6 * scale * scale) return null;
  if (Math.abs(Math.hypot(c, d) - scale) > 1e-6 * scale) return null;
  const counterClockwise = (Math.atan2(c, a) * 180) / Math.PI;
  const clockwise = (((360 - Math.round(counterClockwise)) % 360) + 360) % 360;
  return clockwise === 0 || clockwise === 90 || clockwise === 180 || clockwise === 270
    ? clockwise
    : null;
};
