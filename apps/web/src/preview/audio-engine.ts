import { readMediaFile } from "@/persistence/opfs";
import type { MediaAsset, MediaClip, Project } from "@movie-desk/core";
import { hasSpeedRamp, isMediaClip, sampleKeyframeTrack, sourceOffsetForRamp } from "@movie-desk/core";
import { sampleVolumeCurve } from "./volume-curve";

// Live audio monitoring uses a rolling schedule instead of decoding and
// scheduling every future asset at play(). At most two decoded source buffers
// are retained, the next 30 seconds are scheduled initially, and another 15
// seconds are appended halfway through the current window.
class AudioEngine {
  private static readonly MAX_CACHED_BUFFERS = 2;
  private static readonly INITIAL_LOOKAHEAD_MS = 30_000;
  private static readonly REFILL_MS = 15_000;
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pendingBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private active: AudioBufferSourceNode[] = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private transportPlayhead = 0;
  private transportStartedAt = 0;
  private transportRate = 1;
  private transportActive = false;
  private anchorContextTime = 0;
  private anchorTimelineMs = 0;
  private scheduledThroughMs = 0;

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
    const promise = this.decode(asset);
    this.pendingBuffers.set(asset.id, promise);
    try {
      const decoded = await promise;
      if (decoded) {
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
    const blob = await readMediaFile(asset.opfsPath);
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
  }

  stop(): void {
    this.generation++;
    this.transportActive = false;
    if (this.refillTimer !== null) clearTimeout(this.refillTimer);
    this.refillTimer = null;
    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped/ended
      }
      source.disconnect();
    }
    this.active = [];
  }

  isTransportDrifted(playheadMs: number, rate: number, toleranceMs = 120): boolean {
    if (!this.transportActive || rate !== this.transportRate) return false;
    const expected =
      this.transportPlayhead + Math.max(0, performance.now() - this.transportStartedAt) * rate;
    return Math.abs(playheadMs - expected) > Math.max(toleranceMs, Math.abs(rate) * 50);
  }

  forget(assetId: string): void {
    this.buffers.delete(assetId);
  }

  retain(assetIds: ReadonlySet<string>): void {
    for (const assetId of this.buffers.keys()) {
      if (!assetIds.has(assetId)) this.buffers.delete(assetId);
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
        entry.clips.push(clip);
        clipsByAsset.set(asset.id, entry);
      }
    }

    for (const { asset, clips } of clipsByAsset.values()) {
      const buffer = await this.bufferFor(asset);
      if (!buffer || generation !== this.generation) continue;
      for (const clip of clips) {
        if (!isMediaClip(clip)) continue;
        this.scheduleClip(buffer, clip, rangeStartMs, rangeEndMs, rate, generation);
      }
    }
  }

  private scheduleClip(
    buffer: AudioBuffer,
    clip: MediaClip,
    rangeStartMs: number,
    rangeEndMs: number,
    rate: number,
    generation: number,
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
    const sourceStartMs = sourceOffsetForRamp(clip, relativeStartMs);
    const sourceEndMs = sourceOffsetForRamp(clip, relativeEndMs);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const when = this.anchorContextTime + (timelineStartMs - this.anchorTimelineMs) / 1000 / rate;
    if (hasSpeedRamp(clip)) {
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
    source.connect(gain).connect(ctx.destination);
    try {
      source.start(
        when,
        Math.max(0, (clip.trimIn + sourceStartMs) / 1000),
        Math.max(0, (sourceEndMs - sourceStartMs) / 1000),
      );
    } catch {
      source.disconnect();
      return;
    }
    this.active.push(source);
    source.onended = () => {
      source.disconnect();
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
