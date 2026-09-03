import { describe, expect, it } from "vitest";
import { RetryBackoff } from "../retry-backoff";

describe("RetryBackoff", () => {
  it("allows the first attempt and doubles the delay on every miss up to the cap", () => {
    const backoff = new RetryBackoff(1_000, 8_000);
    expect(backoff.shouldTry("a", 0)).toBe(true);
    expect(backoff.fail("a", 0)).toBe(1_000);
    expect(backoff.shouldTry("a", 999)).toBe(false);
    expect(backoff.shouldTry("a", 1_000)).toBe(true);
    expect(backoff.fail("a", 1_000)).toBe(2_000);
    expect(backoff.fail("a", 3_000)).toBe(4_000);
    expect(backoff.fail("a", 7_000)).toBe(8_000);
    expect(backoff.fail("a", 15_000)).toBe(8_000);
    expect(backoff.shouldTry("a", 22_999)).toBe(false);
    expect(backoff.shouldTry("a", 23_000)).toBe(true);
  });

  it("resets after a success so a returning file loads at full speed again", () => {
    const backoff = new RetryBackoff(1_000, 8_000);
    backoff.fail("a", 0);
    backoff.fail("a", 1_000);
    backoff.succeed("a");
    expect(backoff.shouldTry("a", 1_001)).toBe(true);
    expect(backoff.fail("a", 1_001)).toBe(1_000);
  });

  it("keeps ids independent and forgets the ones no longer retained", () => {
    const backoff = new RetryBackoff();
    backoff.fail("a", 0);
    backoff.fail("b", 0);
    backoff.retain(new Set(["b"]));
    expect(backoff.shouldTry("a", 0)).toBe(true);
    expect(backoff.shouldTry("b", 0)).toBe(false);
    backoff.clear();
    expect(backoff.shouldTry("b", 0)).toBe(true);
  });
});
