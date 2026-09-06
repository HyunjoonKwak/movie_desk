import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode, framesToMs, msToFrames, snapMsToFrame } from "../time";

describe("non-drop-frame timecode", () => {
  it.each([23.976, 24, 29.97, 30, 60])("round trips frame boundaries at %s fps", (fps) => {
    const nominal = Math.round(fps);
    for (const frame of [
      0,
      1,
      nominal - 1,
      nominal,
      nominal * 60 - 1,
      nominal * 3600,
      10_000_001,
    ]) {
      const ms = framesToMs(frame, fps);
      const text = formatTimecode(ms, fps);
      expect(parseTimecode(text, fps)).toBeCloseTo(ms, 7);
      expect(msToFrames(parseTimecode(text, fps)!, fps)).toBe(frame);
    }
    expect(formatTimecode(framesToMs(nominal, fps), fps)).toBe("00:00:01:00");
    expect(formatTimecode(framesToMs(nominal * 3600, fps), fps)).toBe("01:00:00:00");
  });

  it.each([23.976, 29.97])("rounds the half-frame boundary at actual %s fps", (fps) => {
    expect(msToFrames(framesToMs(10.4999, fps), fps)).toBe(10);
    expect(msToFrames(framesToMs(10.5001, fps), fps)).toBe(11);
    expect(snapMsToFrame(framesToMs(10.5001, fps), fps)).toBeCloseTo(framesToMs(11, fps));
    expect(parseTimecode("00:00:01:00", fps)).not.toBe(1000);
  });

  it.each([
    "",
    "1",
    "00:00:00",
    "00:60:00:00",
    "00:00:60:00",
    "00:00:00:30",
    "-01:00:00:00",
    "00:00:00:00abc",
    "00:00:01.00",
    "99999999999999999:00:00:00",
  ])("rejects %s", (text) => {
    expect(parseTimecode(text, 29.97)).toBeNull();
  });
  it("rejects invalid fps and accepts surrounding whitespace", () => {
    for (const fps of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(parseTimecode("00:00:00:00", fps)).toBeNull();
    expect(parseTimecode(" 00:00:00:01 ", 25)).toBe(40);
    expect(formatTimecode(-10, 25)).toBe("00:00:00:00");
  });
});
