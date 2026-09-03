import { describe, expect, it } from "vitest";
import { RetryBackoff } from "../retry-backoff";

// A settable clock so the tests never sleep.
const clock = (start = 0) => {
  let now = start;
  return {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
  };
};

describe("RetryBackoff", () => {
  it("allows the first attempt and doubles the delay on every miss up to the cap", () => {
    const time = clock();
    const backoff = new RetryBackoff(1_000, 8_000, time.now);
    expect(backoff.shouldTry("a")).toBe(true);
    expect(backoff.fail("a")).toBe(1_000);
    time.set(999);
    expect(backoff.shouldTry("a")).toBe(false);
    time.set(1_000);
    expect(backoff.shouldTry("a")).toBe(true);
    expect(backoff.fail("a")).toBe(2_000);
    time.set(3_000);
    expect(backoff.fail("a")).toBe(4_000);
    time.set(7_000);
    expect(backoff.fail("a")).toBe(8_000);
    time.set(15_000);
    expect(backoff.fail("a")).toBe(8_000);
    time.set(22_999);
    expect(backoff.shouldTry("a")).toBe(false);
    time.set(23_000);
    expect(backoff.shouldTry("a")).toBe(true);
  });

  it("resets after a success so a returning file loads at full speed again", () => {
    const time = clock();
    const backoff = new RetryBackoff(1_000, 8_000, time.now);
    backoff.fail("a");
    time.set(1_000);
    backoff.fail("a");
    backoff.succeed("a");
    time.set(1_001);
    expect(backoff.shouldTry("a")).toBe(true);
    expect(backoff.fail("a")).toBe(1_000);
  });

  it("starts over as soon as a different token is tried for the same id", () => {
    const time = clock();
    const backoff = new RetryBackoff(1_000, 30_000, time.now);
    const original = { id: "a", proxyPath: undefined };
    backoff.fail("a", original);
    time.set(1_000);
    backoff.fail("a", original);
    time.set(1_500);
    expect(backoff.shouldTry("a", original)).toBe(false);
    // A rebuilt proxy or a relink replaces the asset record → try now, and
    // the next miss starts again from the short delay.
    const rebuilt = { ...original, proxyPath: "proxy.mp4" };
    expect(backoff.shouldTry("a", rebuilt)).toBe(true);
    expect(backoff.fail("a", rebuilt)).toBe(1_000);
  });

  it("keeps ids independent and forgets the ones no longer retained", () => {
    const time = clock();
    const backoff = new RetryBackoff(1_000, 30_000, time.now);
    backoff.fail("a");
    backoff.fail("b");
    backoff.retain(new Set(["b"]));
    expect(backoff.shouldTry("a")).toBe(true);
    expect(backoff.shouldTry("b")).toBe(false);
    backoff.clear();
    expect(backoff.shouldTry("b")).toBe(true);
  });
});
