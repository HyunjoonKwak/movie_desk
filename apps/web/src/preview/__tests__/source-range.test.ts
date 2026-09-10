import { describe, expect, it } from "vitest";
import { MIN_RANGE_MS, markIn, markOut } from "../source-range";

const asset = (useInMs?: number, useOutMs?: number) => ({
  durationMs: 10_000,
  ...(useInMs === undefined ? {} : { useInMs }),
  ...(useOutMs === undefined ? {} : { useOutMs }),
});

describe("markIn / markOut", () => {
  it("marks the in point and keeps the existing out point", () => {
    expect(markIn(asset(undefined, 8000), 2000)).toEqual({ inMs: 2000, outMs: 8000 });
    expect(markIn(asset(), 2500.4)).toEqual({ inMs: 2500, outMs: 10_000 });
  });
  it("marks the out point and keeps the existing in point", () => {
    expect(markOut(asset(1000), 7000)).toEqual({ inMs: 1000, outMs: 7000 });
    expect(markOut(asset(), 7000)).toEqual({ inMs: 0, outMs: 7000 });
  });
  it("pushes the other point away so the range never collapses below the minimum", () => {
    expect(markIn(asset(undefined, 3000), 2900)).toEqual({
      inMs: 2900,
      outMs: 2900 + MIN_RANGE_MS,
    });
    expect(markOut(asset(5000), 5050)).toEqual({ inMs: 5050 - MIN_RANGE_MS, outMs: 5050 });
  });
  it("clamps to the file and returns undefined for the whole file", () => {
    expect(markIn(asset(), -50)).toBeUndefined();
    expect(markOut(asset(), 99_999)).toBeUndefined();
    expect(markIn(asset(), 9990)).toEqual({ inMs: 10_000 - MIN_RANGE_MS, outMs: 10_000 });
    expect(markOut(asset(), 10)).toEqual({ inMs: 0, outMs: MIN_RANGE_MS });
  });
});
