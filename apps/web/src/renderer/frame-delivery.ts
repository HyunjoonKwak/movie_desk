// Serialises decoded frames on their way to an analysis sink. WebCodecs emits
// frames from its own output callback while the sink may answer
// asynchronously (an encoder downstream, a canvas readback). The sink is
// called from inside the chain, never from the decoder callback, so one sink
// call runs at a time in emission order, a thenable verdict counts like a
// Promise, and a sink that throws or rejects fails the pass instead of
// poisoning the chain and leaking every later frame.

export type FrameVerdict = "continue" | "stop";

export interface ClosableFrame {
  close(): void;
}

export type FrameSink<TFrame extends ClosableFrame> = (
  frame: TFrame,
  runIndex: number,
) => FrameVerdict | PromiseLike<FrameVerdict>;

export interface FrameDeliveryHooks {
  // Whether frames of the current run are still wanted. A frame reaching the
  // front of the chain while closed is closed unseen.
  readonly isOpen: () => boolean;
  readonly onStop: () => void;
  readonly onFailure: (cause: unknown) => void;
}

export interface FrameDelivery<TFrame extends ClosableFrame> {
  // Queues one frame straight from the decoder's output callback.
  deliver(frame: TFrame, runIndex: number): void;
  // Settles once every queued frame, including ones queued meanwhile, has
  // been handed over or closed. Never rejects: failures go to `onFailure`.
  drain(): Promise<void>;
}

const closeQuietly = (frame: ClosableFrame): void => {
  try {
    frame.close();
  } catch {
    // The sink already closed it; closing twice is not an error worth raising.
  }
};

export const createFrameDelivery = <TFrame extends ClosableFrame>(
  sink: FrameSink<TFrame>,
  hooks: FrameDeliveryHooks,
): FrameDelivery<TFrame> => {
  let chain: Promise<void> = Promise.resolve();

  const handOff = async (frame: TFrame, runIndex: number): Promise<void> => {
    try {
      if (!hooks.isOpen()) {
        closeQuietly(frame);
        return;
      }
      // `await` resolves thenables as well as real Promises.
      const verdict = await sink(frame, runIndex);
      if (verdict === "stop") hooks.onStop();
    } catch (cause) {
      // The sink (or a hook) failed: the frame is closed for it and the pass
      // is told, while the chain stays healthy for the frames behind it.
      closeQuietly(frame);
      try {
        hooks.onFailure(cause);
      } catch {
        // A failing failure hook must not poison the chain either.
      }
    }
  };

  // Frames can be queued while an earlier hand-off is still awaited, so wait
  // until the chain stops growing rather than for a snapshot of it.
  const drain = async (): Promise<void> => {
    let settled: Promise<void>;
    do {
      settled = chain;
      await settled;
    } while (settled !== chain);
  };

  return {
    deliver: (frame, runIndex) => {
      chain = chain.then(() => handOff(frame, runIndex));
    },
    drain,
  };
};
