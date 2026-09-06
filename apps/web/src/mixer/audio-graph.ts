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
  meter?: AudioWorkletNode | undefined;
  destination?: AudioNode;
  hold: PeakHold;
  level: LiveLevel;
}
const silence: SignalLevel = { peak: 0, rms: 0, clippedSamples: 0 };

export class MixerAudioGraph {
  private readonly strips = new Map<string, Strip>();
  private frame = 0;
  private readonly targets = new WeakMap<AudioParam, number>();
  private disposed = false;
  private dirty = false;
  private active = false;

  constructor(
    private readonly ctx: AudioContext,
    private metering: boolean,
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
    const output = panner ?? gain;
    const hold = new PeakHold();
    const strip: Strip = {
      gain,
      ...(panner ? { panner } : {}),
      output,
      hold,
      level: { ...hold.update(silence, 0), shortLufs: null },
    };
    if (this.metering) this.attachMeter(id, strip);
    this.strips.set(id, strip);
    return strip;
  }

  // A zero-output measurement tap never replaces or duplicates the audible route.
  private attachMeter(id: string, strip: Strip): void {
    const meter = new AudioWorkletNode(this.ctx, "movie-desk-meter", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { master: id === "master" },
    });
    strip.meter = meter;
    meter.port.onmessage = (event: MessageEvent<SignalLevel & { shortLufs: number | null }>) => {
      if (this.disposed) return;
      strip.level = {
        ...strip.hold.update(event.data, performance.now()),
        shortLufs: event.data.shortLufs,
      };
      this.dirty = true;
    };
    strip.output.connect(meter);
  }

  enableMetering(): void {
    if (this.disposed || this.metering) return;
    try {
      for (const [id, strip] of this.strips) this.attachMeter(id, strip);
      this.metering = true;
      if (this.active) useMeterStore.setState({ live: true });
    } catch {
      // Node construction can fail even after module loading succeeds.
      for (const strip of this.strips.values()) {
        if (!strip.meter) continue;
        strip.output.disconnect(strip.meter);
        this.closeMeter(strip);
      }
    }
  }

  private parameter(param: AudioParam, value: number): void {
    const previous = this.targets.get(param);
    // Initialize before playback without a startup fade; smooth subsequent edits.
    if (previous === undefined) param.value = value;
    else if (previous !== value) param.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    this.targets.set(param, value);
  }

  private route(strip: Strip, destination: AudioNode): void {
    if (strip.destination === destination) return;
    if (strip.destination) strip.output.disconnect(strip.destination);
    strip.output.connect(destination);
    strip.destination = destination;
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
    this.parameter(master.gain.gain, dbToLinear(project.audio?.master.gainDb ?? 0));
    this.route(master, this.ctx.destination);
    for (const bus of project.audio?.buses ?? []) {
      const strip = this.strip(`bus:${bus.id}`);
      this.parameter(strip.gain.gain, bus.muted ? 0 : dbToLinear(bus.gainDb));
      this.route(strip, master.gain);
    }
    for (const track of project.timeline.tracks) {
      const route = resolveTrackRoute(project, track);
      const strip = this.strip(`track:${track.id}`, true);
      this.parameter(strip.gain.gain, route.trackGain);
      this.parameter(strip.panner!.pan, route.pan);
      this.route(strip, route.busId ? this.strip(`bus:${route.busId}`).gain : master.gain);
    }
    if (!this.active) {
      this.active = true;
      useMeterStore.setState({ live: this.metering, levels: {} });
      this.publish();
    }
  }

  input(trackId: string): AudioNode {
    const strip = this.strip(`track:${trackId}`, true);
    if (!strip.destination) {
      const master = this.strip("master");
      this.route(master, this.ctx.destination);
      this.route(strip, master.gain);
    }
    return strip.gain;
  }

  private publish = (): void => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      useMeterStore.setState({
        levels: Object.fromEntries([...this.strips].map(([id, strip]) => [id, strip.level])),
      });
    }
    if (typeof requestAnimationFrame === "function")
      this.frame = requestAnimationFrame(this.publish);
  };

  private disconnect(strip: Strip): void {
    strip.gain.disconnect();
    strip.panner?.disconnect();
    strip.output.disconnect();
    this.closeMeter(strip);
  }

  private closeMeter(strip: Strip): void {
    if (strip.meter) {
      strip.meter.disconnect();
      strip.meter.port.postMessage({ stop: true });
      strip.meter.port.onmessage = null;
      strip.meter.port.close();
      strip.meter = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    for (const strip of this.strips.values()) this.disconnect(strip);
    this.strips.clear();
    useMeterStore.setState({ live: false, levels: {} });
  }
}
