import { createEmptyProject, type Project } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
import { MixerAudioGraph, loadMeterWorklet } from "../audio-graph";

const fakeContext = () => {
  const nodes: ReturnType<typeof node>[] = [];
  const parameter = () => ({ value: 1, setTargetAtTime: vi.fn() });
  const node = () => ({
    gain: parameter(),
    pan: parameter(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  const create = () => {
    const value = node();
    nodes.push(value);
    return value;
  };
  const context = {
    currentTime: 12,
    destination: node(),
    createGain: create,
    createStereoPanner: create,
  };
  return { ctx: context as unknown as AudioContext, nodes };
};
afterEach(() => vi.unstubAllGlobals());
it("smooths gain/pan edits without reconnecting or rescheduling unchanged parameters", () => {
  const { ctx, nodes } = fakeContext();
  const graph = new MixerAudioGraph(ctx, false);
  const project = createEmptyProject();
  graph.update(project);
  const trackGain = graph.input(
    project.timeline.tracks[0]!.id,
  ) as unknown as (typeof nodes)[number];
  for (const node of nodes) {
    node.connect.mockClear();
    node.disconnect.mockClear();
  }
  const edited: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t, i) =>
        i === 0 ? { ...t, audio: { gainDb: -6, pan: 0.5 } } : t,
      ),
    },
  };
  graph.update(edited);
  expect(nodes.flatMap((n) => n.connect.mock.calls)).toHaveLength(0);
  expect(nodes.flatMap((n) => n.disconnect.mock.calls)).toHaveLength(0);
  expect(trackGain.gain.setTargetAtTime).toHaveBeenCalledWith(10 ** (-6 / 20), 12, 0.01);
  const panner = nodes.find((n) => n.pan.setTargetAtTime.mock.calls.length)!;
  expect(panner.pan.setTargetAtTime).toHaveBeenCalledWith(0.5, 12, 0.01);
  graph.update(edited);
  expect(trackGain.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
  graph.dispose();
});
it("reconnects only the changed route and connects then cleans late track inputs", () => {
  const { ctx, nodes } = fakeContext();
  const graph = new MixerAudioGraph(ctx, false);
  const base = createEmptyProject();
  const project: Project = {
    ...base,
    audio: { buses: [{ id: "b", name: "Bus", gainDb: 0 }], master: { gainDb: 0 } },
  };
  graph.update(project);
  for (const node of nodes) {
    node.connect.mockClear();
    node.disconnect.mockClear();
  }
  const routed: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t, i) =>
        i === 0 ? { ...t, audio: { busId: "b" } } : t,
      ),
    },
  };
  graph.update(routed);
  expect(nodes.flatMap((n) => n.connect.mock.calls)).toHaveLength(1);
  expect(nodes.flatMap((n) => n.disconnect.mock.calls)).toHaveLength(1);
  const start = nodes.length;
  graph.input("late");
  const lateNodes = nodes.slice(start);
  expect(lateNodes.at(-1)!.connect).toHaveBeenCalledTimes(1);
  graph.update(routed);
  expect(lateNodes.every((n) => n.disconnect.mock.calls.length > 0)).toBe(true);
  const counts = lateNodes.map((n) => n.disconnect.mock.calls.length);
  graph.update(routed);
  expect(lateNodes.map((n) => n.disconnect.mock.calls.length)).toEqual(counts);
  graph.dispose();
});
it("supports unavailable/rejected worklets and missing animation-frame globals", async () => {
  const { ctx } = fakeContext();
  expect(await loadMeterWorklet(ctx)).toBe(false);
  expect(
    await loadMeterWorklet({
      audioWorklet: { addModule: vi.fn().mockRejectedValue(new Error("blocked")) },
    } as unknown as AudioContext),
  ).toBe(false);
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  const graph = new MixerAudioGraph(ctx, false);
  expect(() => {
    graph.update(createEmptyProject());
    graph.dispose();
  }).not.toThrow();
});

it("routes through worklet outputs and disposes their ports", () => {
  const { ctx } = fakeContext();
  const meters: FakeMeter[] = [];
  class FakeMeter {
    connect = vi.fn();
    disconnect = vi.fn();
    port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
    constructor() {
      meters.push(this);
    }
  }
  vi.stubGlobal("AudioWorkletNode", FakeMeter);
  const base = createEmptyProject();
  const track = { ...base.timeline.tracks[0]!, audio: { busId: "b" } };
  const project: Project = {
    ...base,
    audio: { buses: [{ id: "b", name: "Bus", gainDb: 0 }], master: { gainDb: 0 } },
    timeline: { ...base.timeline, tracks: [track] },
  };
  const graph = new MixerAudioGraph(ctx, true);
  graph.update(project);
  const gain = graph.input(track.id);
  const panner = vi.mocked(gain.connect).mock.calls[0]![0] as unknown as AudioNode;
  expect(panner.connect).toHaveBeenCalledWith(meters[2]);
  const masterGain = meters[1]!.connect.mock.calls[0]![0];
  const busGain = meters[2]!.connect.mock.calls[0]![0];
  expect(masterGain.connect).toHaveBeenCalledWith(meters[0]);
  expect(busGain.connect).toHaveBeenCalledWith(meters[1]);
  expect(meters[0]!.connect).toHaveBeenCalledWith(ctx.destination);
  for (const meter of meters) meter.connect.mockClear();
  graph.update({ ...project, audio: { ...project.audio!, master: { gainDb: -6 } } });
  expect(meters.flatMap((meter) => meter.connect.mock.calls)).toHaveLength(0);
  graph.dispose();
  for (const meter of meters) {
    expect(meter.disconnect).toHaveBeenCalled();
    expect(meter.port.close).toHaveBeenCalledOnce();
    expect(meter.port.postMessage).toHaveBeenCalledWith({ stop: true });
  }
});
