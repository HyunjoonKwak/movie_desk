import {
  PitchCache,
  pitchCacheKey,
  pitchMainSlice,
  pitchSourceWindow,
  renderPitchInWorker,
} from "@/audio/pitch-renderer";
import { setPitchState } from "@/audio/pitch-state";
import { ProjectAudioMixer } from "@/export/audio-mixer";
import { audioBlobFor } from "@/media/audio/audio-variant";
import { MixerAudioGraph, loadMeterWorklet } from "@/mixer/audio-graph";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import type { MediaAsset, MediaClip, Project } from "@movie-desk/core";
import {
  buildAudioSequencePlan,
  hasSpeedRamp,
  isMediaClip,
  sampleKeyframeTrack,
  sourceOffsetForRamp,
} from "@movie-desk/core";
import { sampleVolumeCurve } from "./volume-curve";

// Live audio monitoring uses a rolling schedule instead of decoding and
// scheduling every future asset at play(). At most two decoded source buffers
// are retained, the next 30 seconds are scheduled initially, and another 15
// seconds are appended halfway through the current window.
export class AudioEngine {
  private static readonly MAX_CACHED_BUFFERS = 2;
  private static readonly INITIAL_LOOKAHEAD_MS = 30_000;
  private static readonly REFILL_MS = 15_000;
  private readonly pitchCache = new PitchCache<AudioBuffer>();
  private readonly pitchRevisions = new Map<string, number>();
  private readonly pitchJobs = new Map<
    string,
    { key: string; controller: AbortController; assetId: string; stateKey: string }
  >();
  private readonly pitchFailed = new Set<string>();
  private readonly fades = new Map<AudioBufferSourceNode, GainNode>();
  private nestedAbort = new AbortController();
  private ctx: AudioContext | null = null;
  private graph: MixerAudioGraph | null = null;
  private readonly clipTracks = new Map<string, string>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pendingBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private active: AudioBufferSourceNode[] = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private meterGeneration = 0;
  private transportPlayhead = 0;
  private transportStartedAt = 0;
  private transportRate = 1;
  private transportActive = false;
  private anchorContextTime = 0;
  private anchorTimelineMs = 0;
  private scheduledThroughMs = 0;
  private fadeThroughTime = 0;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private async bufferFor(asset: MediaAsset): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(asset.id);
    if (cached) {
      this.buffers.delete(asset.id);
      this.buffers.set(asset.id, cached);
      return cached;
    }
    const pending = this.pendingBuffers.get(asset.id);
    if (pending) return pending;
    const revision = this.pitchRevisions.get(asset.id) ?? 0;
    const promise = this.decode(asset);
    this.pendingBuffers.set(asset.id, promise);
    try {
      const decoded = await promise;
      if (decoded && revision === (this.pitchRevisions.get(asset.id) ?? 0)) {
        this.buffers.set(asset.id, decoded);
        while (this.buffers.size > AudioEngine.MAX_CACHED_BUFFERS) {
          const oldest = this.buffers.keys().next().value;
          if (oldest === undefined) break;
          this.buffers.delete(oldest);
        }
      }
      return decoded;
    } finally {
      if (this.pendingBuffers.get(asset.id) === promise) this.pendingBuffers.delete(asset.id);
    }
  }

  private async decode(asset: MediaAsset): Promise<AudioBuffer | null> {
    // The audio-track variant is a few percent of a 4K original; decoding
    // it keeps the file read and the PCM footprint to the audio alone.
    const blob = await audioBlobFor(asset);
    if (!blob) return null;
    try {
      return await this.getCtx().decodeAudioData(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }

  async play(project: Project, fromMs: number, rate: number): Promise<void> {
    this.stop();
    if (rate <= 0) return;
    const generation = this.generation;
    const requestedAt = performance.now();
    const ctx = this.getCtx();
    this.retain(new Set(project.mediaLibrary.map((asset) => asset.id)));
    await ctx.resume();
    if (generation !== this.generation) return;
    const graph = new MixerAudioGraph(ctx, false);
    this.graph = graph;
    const current = useProjectStore.getState().project;
    this.graph.update(current.id === project.id ? current : project);

    const elapsedMs = performance.now() - requestedAt;
    const effectiveFromMs = Math.max(0, fromMs + elapsedMs * rate);
    const leadSeconds = 0.03;
    this.transportPlayhead = effectiveFromMs;
    this.transportStartedAt = performance.now() + leadSeconds * 1000;
    this.transportRate = rate;
    this.transportActive = true;
    this.anchorContextTime = ctx.currentTime + leadSeconds;
    this.anchorTimelineMs = effectiveFromMs;
    this.scheduledThroughMs = Math.min(
      project.timeline.duration,
      effectiveFromMs + AudioEngine.INITIAL_LOOKAHEAD_MS,
    );

    await this.scheduleRange(project, effectiveFromMs, this.scheduledThroughMs, rate, generation);
    if (generation !== this.generation) return;
    this.queueRefill(project, rate, generation);
    // Start measuring only after scheduling the first sound. Pitch replacement
    // advances source generation but keeps this graph, so also capture its identity.
    const meterGeneration = this.meterGeneration;
    void loadMeterWorklet(ctx).then((available) => {
      if (available && meterGeneration === this.meterGeneration && this.graph === graph)
        graph.enableMetering();
    });
  }

  updateRouting(project: Project): void {
    this.graph?.update(project);
  }

  stop(): void {
    this.meterGeneration++;
    this.graph?.dispose();
    this.graph = null;
    this.clipTracks.clear();
    for (const [id, job] of this.pitchJobs) {
      job.controller.abort();
      setPitchState(id, job.stateKey);
    }
    this.pitchJobs.clear();
    this.stopSources();
  }

  private stopSources(fadeSeconds = 0): void {
    this.nestedAbort.abort();
    this.nestedAbort = new AbortController();
    this.generation++;
    this.transportActive = false;
    if (this.refillTimer !== null) clearTimeout(this.refillTimer);
    this.refillTimer = null;
    for (const source of this.active) {
      source.onended = null;
      try {
        const fade = this.fades.get(source);
        if (fadeSeconds && fade && this.ctx) {
          fade.gain.setValueAtTime(1, this.ctx.currentTime);
          fade.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeSeconds);
          source.stop(this.ctx.currentTime + fadeSeconds);
          source.onended = () => {
            source.disconnect();
            fade.disconnect();
          };
        } else source.stop();
      } catch {
        // already stopped/ended
      }
      if (!fadeSeconds) source.disconnect();
    }
    this.fades.clear();
    this.active = [];
  }

  isTransportDrifted(playheadMs: number, rate: number, toleranceMs = 120): boolean {
    if (!this.transportActive || rate !== this.transportRate) return false;
    const expected =
      this.transportPlayhead + Math.max(0, performance.now() - this.transportStartedAt) * rate;
    return Math.abs(playheadMs - expected) > Math.max(toleranceMs, Math.abs(rate) * 50);
  }

  forget(assetId: string): void {
    for (const [id, job] of this.pitchJobs)
      if (job.assetId === assetId) {
        job.controller.abort();
        this.pitchJobs.delete(id);
        setPitchState(id, job.stateKey);
      }
    this.pitchFailed.clear();
    this.pitchCache.forget(assetId);
    this.pitchRevisions.set(assetId, (this.pitchRevisions.get(assetId) ?? 0) + 1);
    this.buffers.delete(assetId);
    this.pendingBuffers.delete(assetId);
  }

  retain(assetIds: ReadonlySet<string>): void {
    this.pitchCache.retain(assetIds);
    for (const assetId of this.buffers.keys()) {
      if (!assetIds.has(assetId)) this.forget(assetId);
    }
  }

  private queueRefill(project: Project, rate: number, generation: number): void {
    if (this.scheduledThroughMs >= project.timeline.duration) return;
    const delayMs = Math.max(250, AudioEngine.REFILL_MS / rate);
    this.refillTimer = setTimeout(() => {
      this.refillTimer = null;
      if (generation !== this.generation) return;
      const startMs = this.scheduledThroughMs;
      const endMs = Math.min(project.timeline.duration, startMs + AudioEngine.REFILL_MS);
      this.scheduledThroughMs = endMs;
      void this.scheduleRange(project, startMs, endMs, rate, generation)
        .then(() => {
          if (generation === this.generation) this.queueRefill(project, rate, generation);
        })
        .catch(() => {
          if (generation === this.generation) this.stop();
        });
    }, delayMs);
  }

  private async scheduleRange(
    project: Project,
    rangeStartMs: number,
    rangeEndMs: number,
    rate: number,
    generation: number,
  ): Promise<void> {
    if (rangeEndMs <= rangeStartMs) return;
    const soloing = project.timeline.tracks.some((track) => track.solo);
    const clipsByAsset = new Map<string, { asset: MediaAsset; clips: MediaClip[] }>();
    for (const track of project.timeline.tracks) {
      if (track.muted || (soloing && !track.solo)) continue;
      for (const clip of track.clips) {
        if (!isMediaClip(clip) || clip.disabled || clip.speed <= 0) continue;
        if (clip.start >= rangeEndMs || clip.start + clip.duration <= rangeStartMs) continue;
        const asset = project.mediaLibrary.find((candidate) => candidate.id === clip.assetId);
        if (!asset || (asset.kind !== "audio" && asset.kind !== "video")) continue;
        const entry = clipsByAsset.get(asset.id) ?? { asset, clips: [] };
        this.clipTracks.set(clip.id, track.id);
        entry.clips.push(clip);
        clipsByAsset.set(asset.id, entry);
      }
    }

    for (const { asset, clips } of clipsByAsset.values()) {
      const buffer = await this.bufferFor(asset);
      if (!buffer || generation !== this.generation) continue;
      for (const clip of clips) {
        if (!isMediaClip(clip)) continue;
        const key = pitchCacheKey(clip, buffer.sampleRate, this.pitchRevisions.get(asset.id) ?? 0);
        const pitched = clip.preservePitch ? this.pitchCache.get(key) : undefined;
        this.scheduleClip(
          pitched ?? buffer,
          clip,
          rangeStartMs,
          rangeEndMs,
          rate,
          generation,
          !!pitched,
        );
        if (clip.preservePitch && !pitched) void this.preparePitch(buffer, clip, key);
      }
    }

    const plan = buildAudioSequencePlan(project);
    for (const entry of plan.clips) {
      const clip = entry.clip;
      if (clip.kind !== "sequence") continue;
      const start = Math.max(rangeStartMs, clip.start);
      const end = Math.min(rangeEndMs, clip.start + clip.duration);
      if (end <= start) continue;
      // Render the folded source with the same evaluator as export. The live
      // root graph still owns parent track/bus/master controls and smoothing.
      const mixer = new ProjectAudioMixer(
        project,
        (id) => project.mediaLibrary.find((asset) => asset.id === id),
        undefined,
        {
          ...plan,
          clips: [
            { ...entry, route: { trackGain: 1, busGain: 1, masterGain: 1, pan: 0, busId: null } },
          ],
        },
        true,
      );
      const signal = this.nestedAbort.signal;
      try {
        for await (const chunk of mixer.chunks({
          startMs: start,
          endMs: end,
          chunkDurationMs: 1000,
          signal,
        })) {
          if (generation !== this.generation) return;
          const buffer = this.getCtx().createBuffer(2, chunk.channels[0].length, chunk.sampleRate);
          for (let c = 0; c < 2; c++)
            buffer.copyToChannel(Float32Array.from(chunk.channels[c]!), c);
          const segmentStart =
            (Math.floor((start / 1000) * chunk.sampleRate) * 1000) / chunk.sampleRate +
            (chunk.startSample * 1000) / chunk.sampleRate;
          const segment: MediaClip = {
            ...clip,
            kind: "media",
            assetId: clip.timelineId,
            start: segmentStart,
            duration: (buffer.length * 1000) / chunk.sampleRate,
            trimIn: 0,
            trimOut: (buffer.length * 1000) / chunk.sampleRate,
            speed: 1,
            volume: 1,
            effects: [],
            keyframes: [],
          };
          this.clipTracks.set(segment.id, entry.trackId);
          this.scheduleClip(buffer, segment, start, end, rate, generation, true);
        }
      } catch (error) {
        // A superseded play must not reject into the playback hook and stop
        // its replacement transport. Current-generation failures still escape.
        if (generation !== this.generation) return;
        throw error;
      } finally {
        mixer.dispose();
      }
    }
  }

  private async preparePitch(buffer: AudioBuffer, clip: MediaClip, key: string): Promise<void> {
    const existing = this.pitchJobs.get(clip.id);
    if (existing?.key === key || this.pitchFailed.has(key)) return;
    existing?.controller.abort();
    const controller = new AbortController();
    const stateKey = pitchCacheKey(clip, 0);
    const outputSamples = Math.floor((clip.duration * buffer.sampleRate) / 1000);
    const bytes = outputSamples * buffer.numberOfChannels * 4;
    const { lower, upper } = pitchSourceWindow({
      clip,
      offsetMs: 0,
      outputSamples,
      sourceSampleRate: buffer.sampleRate,
      outputSampleRate: buffer.sampleRate,
    });
    const sourceBytes =
      Math.max(0, Math.min(buffer.length, upper) - Math.min(buffer.length, lower)) *
      buffer.numberOfChannels *
      4;
    // Admission bounds retained output and the transmitted source window separately.
    if (bytes > this.pitchCache.limit || sourceBytes > this.pitchCache.limit) {
      setPitchState(clip.id, stateKey, "fallback");
      return;
    }
    this.pitchJobs.set(clip.id, { key, controller, assetId: clip.assetId, stateKey });
    setPitchState(clip.id, stateKey, "rendering");
    try {
      const channels = await renderPitchInWorker(
        {
          channels: Array.from({ length: buffer.numberOfChannels }, (_, c) =>
            buffer.getChannelData(c),
          ),
          sourceSampleRate: buffer.sampleRate,
          outputSampleRate: buffer.sampleRate,
          clip,
          offsetMs: 0,
          outputSamples,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const rendered = pitchMainSlice(() =>
        this.getCtx().createBuffer(channels.length, outputSamples, buffer.sampleRate),
      );
      for (let c = 0; c < channels.length; c++) {
        for (let at = 0; at < outputSamples; at += 65536) {
          pitchMainSlice(() =>
            rendered.copyToChannel(Float32Array.from(channels[c]!.subarray(at, at + 65536)), c, at),
          );
          if (at % 524288 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      const project = useProjectStore.getState().project;
      const current = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clip.id);
      if (
        !controller.signal.aborted &&
        current &&
        isMediaClip(current) &&
        key ===
          pitchCacheKey(current, buffer.sampleRate, this.pitchRevisions.get(clip.assetId) ?? 0)
      ) {
        this.pitchCache.set(key, rendered, bytes, clip.assetId);
        setPitchState(clip.id, stateKey, "ready");
        if (this.transportActive) {
          const ctx = this.getCtx();
          const now =
            this.anchorTimelineMs +
            Math.max(0, ctx.currentTime - this.anchorContextTime) * 1000 * this.transportRate;
          const rate = this.transportRate;
          this.stopSources(0.02);
          this.transportActive = true;
          this.fadeThroughTime = ctx.currentTime + 0.03;
          this.anchorContextTime = ctx.currentTime;
          this.anchorTimelineMs = now;
          this.scheduledThroughMs = Math.min(
            project.timeline.duration,
            now + AudioEngine.INITIAL_LOOKAHEAD_MS,
          );
          const generation = this.generation;
          await this.scheduleRange(project, now, this.scheduledThroughMs, rate, generation);
          if (generation === this.generation) this.queueRefill(project, rate, generation);
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        this.pitchFailed.add(key);
        setPitchState(clip.id, stateKey, "fallback");
      }
    } finally {
      if (this.pitchJobs.get(clip.id)?.controller === controller) this.pitchJobs.delete(clip.id);
    }
  }

  private scheduleClip(
    buffer: AudioBuffer,
    clip: MediaClip,
    rangeStartMs: number,
    rangeEndMs: number,
    rate: number,
    generation: number,
    pitched = false,
  ): void {
    const ctx = this.getCtx();
    const timelineNowMs =
      this.anchorTimelineMs +
      Math.max(0, ctx.currentTime + 0.01 - this.anchorContextTime) * 1000 * rate;
    const clipEndMs = clip.start + clip.duration;
    const timelineStartMs = Math.max(clip.start, rangeStartMs, timelineNowMs);
    const timelineEndMs = Math.min(clipEndMs, rangeEndMs);
    if (timelineEndMs <= timelineStartMs || generation !== this.generation) return;

    const relativeStartMs = timelineStartMs - clip.start;
    const relativeEndMs = timelineEndMs - clip.start;
    const sourceStartMs = pitched ? relativeStartMs : sourceOffsetForRamp(clip, relativeStartMs);
    const sourceEndMs = pitched ? relativeEndMs : sourceOffsetForRamp(clip, relativeEndMs);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const when = this.anchorContextTime + (timelineStartMs - this.anchorTimelineMs) / 1000 / rate;
    if (pitched) {
      source.playbackRate.value = rate;
    } else if (hasSpeedRamp(clip)) {
      const speedTrack = clip.keyframes.find((track) => track.target === "speed");
      const timelineDurationMs = timelineEndMs - timelineStartMs;
      const curveDurationSec = timelineDurationMs / 1000 / rate;
      const samples = Math.max(2, Math.min(256, Math.ceil(timelineDurationMs / 40) + 1));
      const curve = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        const relativeMs = relativeStartMs + (i / (samples - 1)) * timelineDurationMs;
        curve[i] =
          Math.max(
            0.05,
            speedTrack ? (sampleKeyframeTrack(speedTrack, relativeMs) ?? clip.speed) : clip.speed,
          ) * rate;
      }
      source.playbackRate.setValueCurveAtTime(curve, when, Math.max(0.001, curveDurationSec));
    } else {
      source.playbackRate.value = clip.speed * rate;
    }
    const gain = ctx.createGain();
    const volumeTrack = clip.keyframes.find((track) => track.target === "volume");
    if (volumeTrack) {
      // Keyframed volume (music bed fades, ducking) — rendered as a gain
      // curve exactly like the speed ramp above, mirroring the export
      // mixer's replace-not-multiply semantics.
      const timelineDurationMs = timelineEndMs - timelineStartMs;
      const samples = Math.max(2, Math.min(256, Math.ceil(timelineDurationMs / 40) + 1));
      const curve = sampleVolumeCurve(
        volumeTrack,
        clip.volume ?? 1,
        relativeStartMs,
        relativeEndMs,
        samples,
      );
      gain.gain.setValueCurveAtTime(curve, when, Math.max(0.001, timelineDurationMs / 1000 / rate));
    } else {
      gain.gain.value = clip.volume ?? 1;
    }
    const fade = ctx.createGain();
    if (when < this.fadeThroughTime) {
      fade.gain.setValueAtTime(0, when);
      fade.gain.linearRampToValueAtTime(1, when + 0.02);
    }
    source.connect(gain).connect(fade);
    const trackId = this.clipTracks.get(clip.id);
    fade.connect(this.graph && trackId ? this.graph.input(trackId) : ctx.destination);
    this.fades.set(source, fade);
    try {
      source.start(
        when,
        Math.max(0, ((pitched ? 0 : clip.trimIn) + sourceStartMs) / 1000),
        Math.max(0, (sourceEndMs - sourceStartMs) / 1000),
      );
    } catch {
      source.disconnect();
      return;
    }
    this.active.push(source);
    source.onended = () => {
      source.disconnect();
      fade.disconnect();
      this.fades.delete(source);
      const index = this.active.indexOf(source);
      if (index >= 0) this.active.splice(index, 1);
    };
  }
}

let singleton: AudioEngine | null = null;

export const getAudioEngine = (): AudioEngine => {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
};

// A second transport (the source viewer) gets its own engine and context so
// its schedule never competes with the timeline monitor.
export const createAudioEngine = (): AudioEngine => new AudioEngine();
