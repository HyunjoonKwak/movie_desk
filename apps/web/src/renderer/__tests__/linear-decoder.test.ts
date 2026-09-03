import { afterEach, describe, expect, it, vi } from "vitest";
import { type FrameVerdict, decodeRunsInOrder } from "../linear-decoder";
import { SAMPLE_COUNT, installFakeWebCodecs, openedFixture } from "./webcodecs-fakes";

// The sink contract behind every analysis pass: hand-off is serialised,
// verdicts may be thenables, and a sink that rejects fails the pass without
// leaking frames.

const wholeRun = [{ fromMs: 0, toMs: 120 }];

// A thenable that is not a Promise instance: `instanceof Promise` misses it.
const thenable = (verdict: FrameVerdict): PromiseLike<FrameVerdict> => ({
  // biome-ignore lint/suspicious/noThenProperty: a non-Promise thenable is the point of this test
  then: (onfulfilled, onrejected) => Promise.resolve(verdict).then(onfulfilled, onrejected),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeRunsInOrder", () => {
  it("hands a burst of frames to an async sink one at a time, in order, and finishes", async () => {
    const frames = installFakeWebCodecs("flush");
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await decodeRunsInOrder(openedFixture(), wholeRun, {
      onFrame: async (frame) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(frame.timestamp);
        inFlight -= 1;
        frame.close();
        return "continue" as const;
      },
    });

    expect(result).toBe("done");
    expect(seen).toEqual([0, 40_000, 80_000, 120_000]);
    expect(maxInFlight).toBe(1);
    expect(frames.every((f) => f.closed === 1)).toBe(true);
  });

  it("stops on a thenable verdict and closes the frames still queued behind it", async () => {
    const frames = installFakeWebCodecs("flush");
    const seen: number[] = [];
    const result = await decodeRunsInOrder(openedFixture(), wholeRun, {
      onFrame: (frame) => {
        seen.push(frame.timestamp);
        frame.close();
        return thenable(frame.timestamp === 40_000 ? "stop" : "continue");
      },
    });

    expect(result).toBe("done");
    expect(seen).toEqual([0, 40_000]);
    expect(frames).toHaveLength(SAMPLE_COUNT);
    expect(frames.map((f) => f.closed)).toEqual([1, 1, 1, 1]);
  });

  it("fails the pass when the sink rejects and closes every frame, including its own", async () => {
    const frames = installFakeWebCodecs("flush");
    let calls = 0;
    const result = await decodeRunsInOrder(openedFixture(), wholeRun, {
      onFrame: async () => {
        calls += 1;
        throw new Error("sink rejected");
      },
    });

    expect(result).toBe("failed");
    expect(calls).toBe(1);
    expect(frames).toHaveLength(SAMPLE_COUNT);
    expect(frames.map((f) => f.closed)).toEqual([1, 1, 1, 1]);
  });

  it("reports an abort mid-run as stopped, decodes nothing further and skips later runs", async () => {
    const frames = installFakeWebCodecs("decode");
    const controller = new AbortController();
    const seen: Array<readonly [number, number]> = [];
    const result = await decodeRunsInOrder(
      openedFixture(),
      [
        { fromMs: 0, toMs: 40 },
        { fromMs: 80, toMs: 120 },
      ],
      {
        signal: controller.signal,
        onFrame: (frame, runIndex) => {
          seen.push([runIndex, frame.timestamp]);
          frame.close();
          controller.abort();
          return "continue";
        },
      },
    );

    expect(result).toBe("stopped");
    expect(seen).toEqual([[0, 0]]);
    expect(frames).toHaveLength(1);
    expect(frames.every((f) => f.closed === 1)).toBe(true);
  });
});
