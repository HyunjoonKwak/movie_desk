import exifr from "exifr";

export interface CaptureMeta {
  readonly capturedAt?: number; // epoch ms
  readonly gpsLat?: number;
  readonly gpsLon?: number;
}

// --- pure parsers (unit-tested) -------------------------------------------

// ISO 6709 point location as embedded by phones in the mp4 udta box,
// e.g. "+37.5326+127.0246+048.371/" or "+37.5326-122.4194/".
export const parseIso6709 = (text: string): { lat: number; lon: number } | null => {
  const m = /([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\//.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // All-zero coordinates are overwhelmingly "no fix", not Null Island footage.
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
};

const SECONDS_1904_TO_1970 = 2_082_844_800;

// Find an mvhd box in a raw byte window and read its creation time.
// mvhd layout: [4 size][4 'mvhd'][1 version][3 flags][creation…]
// version 0 → u32 seconds since 1904; version 1 → u64.
export const parseMvhdCreation = (bytes: Uint8Array): number | null => {
  for (let i = 0; i + 8 <= bytes.length - 20; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64)
      continue; // 'mvhd'
    const version = bytes[i + 4];
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    let seconds: number;
    if (version === 1) {
      if (i + 8 + 8 > bytes.length) continue;
      seconds = Number(view.getBigUint64(i + 8));
    } else {
      if (i + 8 + 4 > bytes.length) continue;
      seconds = view.getUint32(i + 8);
    }
    const epochMs = (seconds - SECONDS_1904_TO_1970) * 1000;
    // Sanity window: 1990..now+1day. Cameras with dead clocks write 1904.
    if (epochMs > Date.UTC(1990, 0, 1) && epochMs < Date.now() + 86_400_000) return epochMs;
  }
  return null;
};

// 3GPP `loci` box — ffmpeg writes `-metadata location=` here as BINARY
// 16.16 fixed-point (longitude first), unlike iPhone's textual ©xyz ISO6709.
// Layout after size+'loci': version(1) flags(3) language(2) name(cstr)
// role(1) longitude(4) latitude(4) altitude(4) …
export const parseLoci = (bytes: Uint8Array): { lat: number; lon: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] !== 0x6c || bytes[i + 1] !== 0x6f || bytes[i + 2] !== 0x63 || bytes[i + 3] !== 0x69)
      continue; // 'loci'
    let p = i + 4 + 4 + 2; // version/flags + language
    // skip null-terminated name (bounded)
    const nameEnd = Math.min(bytes.length, p + 256);
    while (p < nameEnd && bytes[p] !== 0) p++;
    p += 1; // NUL
    p += 1; // role
    if (p + 8 > bytes.length) continue;
    const lon = view.getInt32(p) / 65536;
    const lat = view.getInt32(p + 4) / 65536;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue;
    return { lat, lon };
  }
  return null;
};

export const findIso6709 = (bytes: Uint8Array): { lat: number; lon: number } | null => {
  // GPS strings live inside ©xyz / com.apple.quicktime.location atoms; a plain
  // latin1 sweep of the moov window is robust and dependency-free.
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : " ";
  }
  return parseIso6709(text);
};

// --- blob readers -----------------------------------------------------------

const SCAN_BYTES = 4 * 1024 * 1024; // moov sits at the head (faststart) or tail

const readWindow = async (blob: Blob, start: number, end: number): Promise<Uint8Array> =>
  new Uint8Array(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer());

// Videos: scan head+tail windows for mvhd creation time and ISO6709 GPS.
const extractVideoMeta = async (blob: Blob, fallbackMs?: number): Promise<CaptureMeta> => {
  try {
    const head = await readWindow(blob, 0, SCAN_BYTES);
    const tail =
      blob.size > SCAN_BYTES ? await readWindow(blob, blob.size - SCAN_BYTES, blob.size) : head;
    const capturedAt =
      parseMvhdCreation(head) ?? parseMvhdCreation(tail) ?? fallbackMs ?? undefined;
    const gps = findIso6709(head) ?? findIso6709(tail) ?? parseLoci(head) ?? parseLoci(tail);
    return {
      ...(capturedAt !== undefined ? { capturedAt } : {}),
      ...(gps ? { gpsLat: gps.lat, gpsLon: gps.lon } : {}),
    };
  } catch {
    return fallbackMs !== undefined ? { capturedAt: fallbackMs } : {};
  }
};

// Photos: EXIF DateTimeOriginal + GPS via exifr.
const extractPhotoMeta = async (blob: Blob, fallbackMs?: number): Promise<CaptureMeta> => {
  try {
    const data = (await exifr.parse(blob, {
      pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"],
    })) as
      | { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number }
      | undefined;
    const when = data?.DateTimeOriginal ?? data?.CreateDate;
    const capturedAt = when instanceof Date ? when.getTime() : (fallbackMs ?? undefined);
    const hasGps =
      typeof data?.latitude === "number" &&
      typeof data?.longitude === "number" &&
      !(data.latitude === 0 && data.longitude === 0);
    return {
      ...(capturedAt !== undefined ? { capturedAt } : {}),
      ...(hasGps ? { gpsLat: data.latitude, gpsLon: data.longitude } : {}),
    };
  } catch {
    return fallbackMs !== undefined ? { capturedAt: fallbackMs } : {};
  }
};

export const extractCaptureMeta = async (
  blob: Blob,
  kind: "video" | "audio" | "image",
  fallbackMs?: number,
): Promise<CaptureMeta> => {
  if (kind === "image") return extractPhotoMeta(blob, fallbackMs);
  if (kind === "video") return extractVideoMeta(blob, fallbackMs);
  return fallbackMs !== undefined ? { capturedAt: fallbackMs } : {};
};
