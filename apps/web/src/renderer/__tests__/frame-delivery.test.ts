import { describe, expect, it } from "vitest";
import { type FrameVerdict, createFrameDelivery } from "../frame-delivery";

interface FakeFrame {
  readonly id: number;
  closed: number;
  close(): void;
}

const frame = (id: number): FakeFrame => ({
  id,
  closed: 0,
  close() {
    this.closed += 1;
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const harness = (sink: (frame: FakeFrame, runIndex: number) => unknown) => {
  const state = { open: true, stops: 0, failures: [] as unknown[] };
  const delivery = createFrameDelivery<FakeFrame>(
    sink as (frame: FakeFrame, runIndex: number) => FrameVerdict | PromiseLike<FrameVerdict>,
    {
      isOpen: () => state.open,
      onStop: () => {
        state.stops += 1;
        state.open = false;
      },
      onFailure: (cause) => {
        state.failures.push(cause);
        state.open = false;
      },
    },
  );
  return { delivery, state };
};

describe("createFrameDelivery", () => {
  it("hands frames to an async sink one at a time, in emission order", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = deferred<void>();
    const { delivery } = harness(async (f) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(f.id);
      if (f.id === 1) await gate.promise;
      inFlight -= 1;
      f.close();
      return "continue";
    });

    const frames = [frame(1), frame(2), frame(3)];
    for (const f of frames) delivery.deliver(f, 0);
    await Promise.resolve();
    // The first hand-off is still waiting on the gate; nothing else started.
    expect(seen).toEqual([1]);
    gate.resolve();
    await delivery.drain();

    expect(seen).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(1);
    expect(frames.map((f) => f.closed)).toEqual([1, 1, 1]);
  });

  it("honours a thenable verdict and closes frames queued behind a stop unseen", async () => {
    const seen: number[] = [];
    const { delivery, state } = harness((f) => {
      seen.push(f.id);
      f.close();
      // A bare thenable, not a Promise instance.
      return {
        // biome-ignore lint/suspicious/noThenProperty: a non-Promise thenable is the point of this test
        then: (resolve: (v: FrameVerdict) => void) => resolve(f.id === 2 ? "stop" : "continue"),
      };
    });

    const frames = [frame(1), frame(2), frame(3), frame(4)];
    for (const f of frames) delivery.deliver(f, 0);
    await delivery.drain();

    expect(seen).toEqual([1, 2]);
    expect(state.stops).toBe(1);
    expect(frames.map((f) => f.closed)).toEqual([1, 1, 1, 1]);
  });

  it("closes the frame and reports a rejecting sink without breaking the chain", async () => {
    const cause = new Error("sink rejected");
    const seen: number[] = [];
    const { delivery, state } = harness(async (f) => {
      seen.push(f.id);
      if (f.id === 1) throw cause;
      f.close();
      return "continue";
    });

    const frames = [frame(1), frame(2)];
    for (const f of frames) delivery.deliver(f, 0);
    await expect(delivery.drain()).resolves.toBeUndefined();

    expect(state.failures).toEqual([cause]);
    expect(seen).toEqual([1]);
    // The failed frame is closed for the sink; the next one never reaches it.
    expect(frames.map((f) => f.closed)).toEqual([1, 1]);
  });

  it("treats a synchronous throw like a rejection and tolerates a frame the sink already closed", async () => {
    const { delivery, state } = harness((f) => {
      f.close();
      throw new Error("sync throw");
    });
    const f = frame(1);
    delivery.deliver(f, 3);
    await delivery.drain();

    expect(state.failures).toHaveLength(1);
    // closeQuietly ran on top of the sink's own close.
    expect(f.closed).toBe(2);
  });

  it("closes frames that arrive while the run is closed without calling the sink", async () => {
    let calls = 0;
    const { delivery, state } = harness(() => {
      calls += 1;
      return "continue";
    });
    state.open = false;
    const f = frame(1);
    delivery.deliver(f, 0);
    await delivery.drain();

    expect(calls).toBe(0);
    expect(f.closed).toBe(1);
  });

  it("passes the run index bound at delivery time", async () => {
    const runs: number[] = [];
    const { delivery } = harness((f, runIndex) => {
      runs.push(runIndex);
      f.close();
      return "continue";
    });
    delivery.deliver(frame(1), 0);
    delivery.deliver(frame(2), 1);
    await delivery.drain();
    expect(runs).toEqual([0, 1]);
  });
  it("reports a throwing hook as a failure and keeps closing the frames behind it", async () => {
    const seen: number[] = [];
    const state = { open: true, failures: [] as unknown[] };
    const delivery = createFrameDelivery<FakeFrame>(
      (f) => {
        seen.push(f.id);
        f.close();
        return "stop";
      },
      {
        isOpen: () => state.open,
        onStop: () => {
          throw new Error("stop hook broke");
        },
        onFailure: (cause) => {
          state.failures.push(cause);
          state.open = false;
          throw new Error("failure hook broke too");
        },
      },
    );
    const frames = [frame(1), frame(2)];
    for (const f of frames) delivery.deliver(f, 0);
    await expect(delivery.drain()).resolves.toBeUndefined();

    expect(seen).toEqual([1]);
    expect(state.failures.map((e) => (e as Error).message)).toEqual(["stop hook broke"]);
    expect(frames.map((f) => f.closed)).toEqual([2, 1]);
  });

  it("drains frames that were queued while an earlier hand-off was still pending", async () => {
    const seen: number[] = [];
    const late = frame(2);
    let deliveryRef: ReturnType<typeof createFrameDelivery<FakeFrame>> | null = null;
    const { delivery } = harness(async (f) => {
      seen.push(f.id);
      if (f.id === 1) {
        // A decoder output lands while the sink is still busy.
        deliveryRef?.deliver(late, 0);
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      f.close();
      return "continue";
    });
    deliveryRef = delivery;
    delivery.deliver(frame(1), 0);
    await delivery.drain();

    expect(seen).toEqual([1, 2]);
    expect(late.closed).toBe(1);
  });
});
