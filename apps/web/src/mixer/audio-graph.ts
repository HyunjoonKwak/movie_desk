import {
  PeakHold,
  dbToLinear,
  resolveTrackRoute,
  type Project,
  type SignalLevel,
} from "@movie-desk/core";
import { meterWorkletSource } from "./meter-worklet";
import { type LiveLevel, useMeterStore } from "./meter-store";

const modules = new WeakMap<BaseAudioContext, Promise<boolean>>();
export const loadMeterWorklet = (ctx: BaseAudioContext): Promise<boolean> => {
  let promise = modules.get(ctx);
  if (!promise) {
    promise = (async () => {
      if (!ctx.audioWorklet) return false;
      const url = URL.createObjectURL(new Blob([meterWorkletSource], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    modules.set(ctx, promise);
  }
  return promise;
};

interface Strip {
  gain: GainNode;
  panner?: StereoPannerNode;
  output: AudioNode;
  meter?: AudioWorkletNode;
  hold: PeakHold;
  level: LiveLevel;
}
const silence: SignalLevel = { peak: 0, rms: 0, clippedSamples: 0 };

export class MixerAudioGraph {
  private readonly strips = new Map<string, Strip>();
  private frame = 0;
  private disposed = false;
  private dirty = false;
  private active = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly metering: boolean,
  ) {}

  private strip(id: string, pan = false): Strip {
    const existing = this.strips.get(id);
    if (existing) return existing;
    const gain = this.ctx.createGain();
    // Force the existing mono-to-stereo duplication BEFORE StereoPanner.
    gain.channelCount = 2;
    gain.channelCountMode = "explicit";
    const panner = pan ? this.ctx.createStereoPanner() : undefined;
    if (panner) gain.connect(panner);
    const meter = this.metering
      ? new AudioWorkletNode(this.ctx, "movie-desk-meter", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
          processorOptions: { master: id === "master" },
        })
      : undefined;
    const output = meter ?? panner ?? gain;
    if (meter) (panner ?? gain).connect(meter);
    const hold = new PeakHold();
    const strip: Strip = {
      gain,
      ...(panner ? { panner } : {}),
      output,
      ...(meter ? { meter } : {}),
      hold,
      level: { ...hold.update(silence, 0), shortLufs: null },
    };
    if (meter)
      meter.port.onmessage = (event: MessageEvent<SignalLevel & { shortLufs: number | null }>) => {
        if (this.disposed) return;
        strip.level = {
          ...hold.update(event.data, performance.now()),
          shortLufs: event.data.shortLufs,
        };
        this.dirty = true;
      };
    this.strips.set(id, strip);
    return strip;
  }

  update(project: Project): void {
    const wanted = new Set([
      "master",
      ...(project.audio?.buses ?? []).map((bus) => `bus:${bus.id}`),
      ...project.timeline.tracks.map((track) => `track:${track.id}`),
    ]);
    for (const [id, strip] of this.strips) {
      if (wanted.has(id)) continue;
      this.disconnect(strip);
      this.strips.delete(id);
    }
    const master = this.strip("master");
    master.gain.gain.value = dbToLinear(project.audio?.master.gainDb ?? 0);
    master.output.disconnect();
    master.output.connect(this.ctx.destination);
    for (const bus of project.audio?.buses ?? []) {
      const strip = this.strip(`bus:${bus.id}`);
      strip.gain.gain.value = bus.muted ? 0 : dbToLinear(bus.gainDb);
      strip.output.disconnect();
      strip.output.connect(master.gain);
    }
    for (const track of project.timeline.tracks) {
      const route = resolveTrackRoute(project, track);
      const strip = this.strip(`track:${track.id}`, true);
      strip.gain.gain.value = route.trackGain;
      strip.panner!.pan.value = route.pan;
      strip.output.disconnect();
      strip.output.connect(route.busId ? this.strip(`bus:${route.busId}`).gain : master.gain);
    }
    if (!this.active) {
      this.active = true;
      useMeterStore.setState({ live: this.metering, levels: {} });
      this.publish();
    }
  }

  input(trackId: string): AudioNode {
    return this.strip(`track:${trackId}`, true).gain;
  }

  private publish = (): void => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      useMeterStore.setState({
        levels: Object.fromEntries([...this.strips].map(([id, strip]) => [id, strip.level])),
      });
    }
    this.frame = requestAnimationFrame(this.publish);
  };

  private disconnect(strip: Strip): void {
    strip.gain.disconnect();
    strip.panner?.disconnect();
    strip.output.disconnect();
    if (strip.meter) {
      strip.meter.port.postMessage({ stop: true });
      strip.meter.port.onmessage = null;
      strip.meter.port.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const strip of this.strips.values()) this.disconnect(strip);
    this.strips.clear();
    useMeterStore.setState({ live: false, levels: {} });
  }
}
