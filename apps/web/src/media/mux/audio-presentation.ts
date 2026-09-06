export interface AudioPresentation {
  readonly offsetSamples: number;
  readonly lengthSamples: number;
  readonly sampleRate: number;
}
interface Box {
  start: number;
  end: number;
  type: string;
}

// The pinned muxer rejects negative timestamps and has no encoder-delay option.
// Reserve its existing two-entry edit list with a positive audio start, then
// rewrite only timing metadata. Packet bytes, sample tables and offsets remain
// untouched, including the last packet containing requested audio samples.
export const applyAudioPresentation = (
  buffer: ArrayBuffer,
  presentation: AudioPresentation,
): void => {
  const view = new DataView(buffer);
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    for (let at = start; at + 8 <= end; ) {
      const size32 = view.getUint32(at);
      const size = size32 === 1 ? Number(view.getBigUint64(at + 8)) : size32 || end - at;
      if (!Number.isSafeInteger(size) || size < 8 || at + size > end)
        throw new Error("Invalid MP4 box");
      const type = String.fromCharCode(...new Uint8Array(buffer, at + 4, 4));
      result.push({ start: at, end: at + size, type });
      at += size;
    }
    return result;
  };
  const children = (box: Box) =>
    boxes(box.start + (view.getUint32(box.start) === 1 ? 16 : 8), box.end);
  const child = (parent: Box, type: string) => {
    const found = children(parent).find((box) => box.type === type);
    if (!found) throw new Error(`MP4 presentation requires ${type}`);
    return found;
  };
  const version = (box: Box) => view.getUint8(box.start + 8);
  const timeScale = (box: Box) => view.getUint32(box.start + (version(box) === 1 ? 28 : 20));
  const durationOffset = (box: Box) =>
    box.start +
    (box.type === "tkhd" ? (version(box) === 1 ? 36 : 28) : version(box) === 1 ? 32 : 24);
  const writeDuration = (box: Box, duration: number) => {
    if (version(box) === 1) view.setBigUint64(durationOffset(box), BigInt(Math.round(duration)));
    else view.setUint32(durationOffset(box), Math.round(duration));
  };
  const readDuration = (box: Box) =>
    version(box) === 1
      ? Number(view.getBigUint64(durationOffset(box)))
      : view.getUint32(durationOffset(box));
  const moov = boxes(0, buffer.byteLength).find((box) => box.type === "moov");
  if (!moov) throw new Error("MP4 presentation requires moov");
  const mvhd = child(moov, "mvhd");
  const movieScale = timeScale(mvhd);
  const duration = (presentation.lengthSamples / presentation.sampleRate) * movieScale;
  let foundAudio = false;
  let movieDuration = 0;
  for (const track of children(moov).filter((box) => box.type === "trak")) {
    const mdia = child(track, "mdia");
    const hdlr = child(mdia, "hdlr");
    const handler = String.fromCharCode(...new Uint8Array(buffer, hdlr.start + 16, 4));
    const tkhd = child(track, "tkhd");
    if (handler === "soun") {
      const elst = child(child(track, "edts"), "elst");
      const mdhd = child(mdia, "mdhd");
      const mediaOffset = Math.round(
        (presentation.offsetSamples / presentation.sampleRate) * timeScale(mdhd),
      );
      const v1 = version(elst) === 1;
      if (view.getUint32(elst.start + 12) !== 2)
        throw new Error("AAC edit list reservation missing");
      const first = elst.start + 16;
      const second = first + (v1 ? 20 : 12);
      if (v1) {
        view.setBigUint64(first, BigInt(Math.round(duration)));
        view.setBigInt64(first + 8, BigInt(mediaOffset));
        view.setBigUint64(second, 0n);
        view.setBigInt64(second + 8, -1n);
      } else {
        view.setUint32(first, Math.round(duration));
        view.setInt32(first + 4, mediaOffset);
        view.setUint32(second, 0);
        view.setInt32(second + 4, -1);
      }
      // Both reserved entries already use media_rate=1.0.
      writeDuration(tkhd, duration);
      foundAudio = true;
    }
    movieDuration = Math.max(movieDuration, readDuration(tkhd));
  }
  if (!foundAudio) throw new Error("AAC presentation requires an audio track");
  writeDuration(mvhd, movieDuration);
};
