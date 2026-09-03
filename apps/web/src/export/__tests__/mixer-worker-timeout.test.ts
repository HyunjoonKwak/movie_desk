import { createEmptyProject } from "@movie-desk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectAudioMixer } from "../audio-mixer";

// A worker that loads but never answers — what a bundler bootstrap that
// cannot run inside the worker looks like from the main thread. The export
// used to wait on it forever at "rendering 99%".
class SilentWorker {
  static created = 0;
  static terminated = 0;
  constructor() {
    SilentWorker.created += 1;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(): void {}
  terminate(): void {
    SilentWorker.terminated += 1;
  }
}

const globalWithWorker = globalThis as { Worker?: unknown };

describe("mixer worker that never answers", () => {
  afterEach(() => {
    vi.useRealTimers();
    globalWithWorker.Worker = undefined;
  });

  it("falls back to inline mixing after the reply timeout and stops using the worker", async () => {
    vi.useFakeTimers();
    globalWithWorker.Worker = SilentWorker;
    const base = createEmptyProject();
    const project = { ...base, timeline: { ...base.timeline, duration: 2000 } };
    const mixer = new ProjectAudioMixer(project, () => undefined);

    const run = (async () => {
      const lengths: number[] = [];
      for await (const chunk of mixer.chunks({ chunkDurationMs: 1000 })) {
        lengths.push(chunk.channels[0].length);
      }
      return lengths;
    })();
    await vi.advanceTimersByTimeAsync(6_000);

    expect(await run).toEqual([48_000, 48_000]);
    // One silent worker is enough evidence: it is terminated and the second
    // chunk never waits on a worker again.
    expect(SilentWorker.created).toBe(1);
    expect(SilentWorker.terminated).toBe(1);
    mixer.dispose();
  });
});
