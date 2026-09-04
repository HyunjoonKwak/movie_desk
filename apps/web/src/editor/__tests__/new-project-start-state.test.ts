import { describe, expect, it } from "vitest";
import {
  clearNewProjectStartPending,
  isNewProjectStartPending,
  markNewProjectStartPending,
  type PendingStartStorage,
} from "../new-project-start-state";

const memoryStorage = (): PendingStartStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe("new-project start state", () => {
  it("keeps pending guidance isolated by project id until a path is chosen", () => {
    const storage = memoryStorage();

    markNewProjectStartPending("project-a", storage);

    expect(isNewProjectStartPending("project-a", storage)).toBe(true);
    expect(isNewProjectStartPending("project-b", storage)).toBe(false);

    clearNewProjectStartPending("project-a", storage);
    expect(isNewProjectStartPending("project-a", storage)).toBe(false);
  });

  it("stays non-blocking when local storage is unavailable", () => {
    const unavailable: PendingStartStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(() => markNewProjectStartPending("project-a", unavailable)).not.toThrow();
    expect(isNewProjectStartPending("project-a", unavailable)).toBe(false);
    expect(() => clearNewProjectStartPending("project-a", unavailable)).not.toThrow();
  });
});
