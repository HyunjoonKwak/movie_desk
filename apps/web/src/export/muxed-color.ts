import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { isBt709Output } from "./bt709-frame";

// The container has the last word on output colour: an encoder can leave
// colorSpace out of its decoderConfig callback while the muxer still writes
// a correct colr atom. Reads the finished file back and checks that atom.
export const muxedColorIsBt709 = async (buffer: ArrayBuffer | Uint8Array): Promise<boolean> => {
  try {
    const input = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    if (!video) return false;
    const color = await video.getColorSpace();
    return isBt709Output({
      ...(color.primaries ? { primaries: color.primaries } : {}),
      ...(color.transfer ? { transfer: color.transfer } : {}),
      ...(color.matrix ? { matrix: color.matrix } : {}),
      ...(color.fullRange === null || color.fullRange === undefined
        ? {}
        : { fullRange: color.fullRange }),
    });
  } catch {
    return false;
  }
};
