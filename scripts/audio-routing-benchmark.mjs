import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))(
  "esbuild",
);
// Frozen pre-sharing baseline: deliberately rebuilds the asset map per consumer.
// Kept inline so paired measurements also work without Git history.
const baselineBody = `
  const tracks = id === "master" ? project.timeline.tracks : project.timeline.tracks.filter(
    track => id === "track:" + track.id || id === "bus:" + track.audio?.busId);
  const assets = new Map(project.mediaLibrary.map(asset => [asset.id, asset]));
  let peak = 0;
  for (const track of tracks) {
    const route = resolveTrackRoute(project, track);
    const [ll, lr, rl, rr] = stereoPanMatrix(route.pan);
    const scale = route.trackGain * Math.max(ll + lr, rl + rr)
      * (id.startsWith("track:") ? 1 : route.busGain)
      * (id === "master" ? route.masterGain : 1);
    peak = Math.max(peak, scale * playheadLevel(
      { ...project, timeline: { ...project.timeline, tracks: [track] } },
      assetId => assets.get(assetId),
      assetId => assets.get(assetId)?.waveformPeaks ?? waveforms[assetId]));
  }
  return peak;
`;
const result = await build({
  stdin: {
    contents: `export * from "./packages/core/src/audio-routing/index.ts";
       export { createEmptyProject } from "./packages/core/src/index.ts";
       export { estimatedLevels } from "./apps/web/src/mixer/estimated-levels.ts";
       import { resolveTrackRoute, stereoPanMatrix } from "./packages/core/src/audio-routing/index.ts";
       import { playheadLevel } from "./apps/web/src/preview/playhead-level.ts";
       export const baselineEstimate = (project, id, waveforms) => { ${baselineBody} };
       export { MixerAudioGraph, loadMeterWorklet } from "./apps/web/src/mixer/audio-graph.ts";
       export { ProjectAudioMixer } from "./apps/web/src/export/audio-mixer.ts";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "AudioBench",
  logLevel: "silent",
  alias: {
    "@movie-desk/core": resolve("packages/core/src/index.ts"),
    "@": resolve("apps/web/src"),
  },
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // A secure local page enables AudioWorklet without reaching any service.
  await page.route("http://localhost/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Audio routing benchmark</title>",
    }),
  );
  await page.goto("http://localhost/audio-bench");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const measurements = await page.evaluate(async () => {
    const { MixerAudioGraph, loadMeterWorklet, ProjectAudioMixer } = AudioBench;
    const source = [
      Float32Array.from(
        { length: 4800 },
        (_, i) => 0.2 * Math.sin((2 * Math.PI * 1000 * i) / 48000),
      ),
      Float32Array.from(
        { length: 4800 },
        (_, i) => 0.1 * Math.cos((2 * Math.PI * 700 * i) / 48000),
      ),
    ];
    const cases = [];
    // Worker fallback is intentional: the test exercises the real mixer PCM stage.
    globalThis.Worker = undefined;
    for (const mono of [false, true])
      for (const pan of [-1, -0.5, 0, 0.5, 1]) {
        const ctx = new OfflineAudioContext(2, 4800, 48000);
        const track = {
          id: "track",
          kind: "audio",
          name: "A1",
          muted: false,
          solo: false,
          locked: false,
          height: 48,
          audio: { gainDb: -6, pan, busId: "bus" },
          clips: [
            {
              id: "clip",
              assetId: "asset",
              kind: "media",
              start: 0,
              duration: 100,
              trimIn: 0,
              trimOut: 100,
              speed: 1,
              volume: 0.5,
              effects: [],
              keyframes: [],
            },
          ],
        };
        const project = {
          audio: { buses: [{ id: "bus", name: "Bus", gainDb: -3 }], master: { gainDb: 2 } },
          timeline: { duration: 100, tracks: [track] },
        };
        const graph = new MixerAudioGraph(ctx, await loadMeterWorklet(ctx));
        graph.update(project);
        const buffer = ctx.createBuffer(mono ? 1 : 2, 4800, 48000);
        buffer.copyToChannel(source[0], 0);
        if (!mono) buffer.copyToChannel(source[1], 1);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        const clipGain = ctx.createGain();
        clipGain.gain.value = 0.5;
        node.connect(clipGain).connect(graph.input("track"));
        node.start();
        const rendered = await ctx.startRendering();
        const mixer = new ProjectAudioMixer(project, () => ({ id: "asset", kind: "audio" }));
        mixer.buffers.set("asset", buffer);
        let maxError = 0;
        for await (const chunk of mixer.chunks())
          for (let c = 0; c < 2; c++)
            for (let i = 0; i < chunk.channels[c].length; i++)
              maxError = Math.max(
                maxError,
                Math.abs(chunk.channels[c][i] - rendered.getChannelData(c)[i + chunk.startSample]),
              );
        cases.push({ mono, pan, maxError });
        graph.dispose();
        mixer.dispose();
      }
    const ctx = new OfflineAudioContext(2, 128, 48000);
    const graph = new MixerAudioGraph(ctx, await loadMeterWorklet(ctx));
    graph.update({
      timeline: {
        tracks: Array.from({ length: 8 }, (_, i) => ({
          id: String(i),
          audio: {},
          muted: false,
          solo: false,
        })),
      },
    });
    const nativeRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;
    const frameMs = [];
    for (let i = 0; i < 1000; i++) {
      const begin = performance.now();
      for (const strip of graph.strips.values())
        strip.meter.port.onmessage({
          data: { peak: 0.5, rms: 0.3, clippedSamples: 0, shortLufs: -20 },
        });
      graph.publish();
      frameMs.push(performance.now() - begin);
    }
    graph.dispose();
    globalThis.requestAnimationFrame = nativeRaf;
    frameMs.sort((a, b) => a - b);
    const base = AudioBench.createEmptyProject();
    const mediaLibrary = Array.from({ length: 1000 }, (_, i) => ({
      id: `asset${i}`,
      name: `Asset ${i}`,
      kind: "audio",
      mime: "audio/wav",
      importedAt: 0,
      durationMs: 1000,
      waveformPeaks: [0.5, 0.25],
    }));
    const tracks = Array.from({ length: 8 }, (_, t) => ({
      ...base.timeline.tracks[0],
      id: `track${t}`,
      clips: Array.from({ length: 125 }, (_, c) => ({
        id: `clip${t}-${c}`,
        kind: "media",
        assetId: mediaLibrary[t * 125 + c].id,
        start: c * 1000,
        duration: 1000,
        trimIn: 0,
        trimOut: 1000,
        speed: 1,
        effects: [],
        keyframes: [],
      })),
    }));
    const fixture = { ...base, mediaLibrary, timeline: { ...base.timeline, tracks } };
    const ids = [
      ...tracks.map((t) => `track:${t.id}`),
      ...tracks.map((t) => `track:${t.id}`),
      "master",
    ];
    const waveforms = {};
    const nativeMap = globalThis.Map;
    let maps = 0;
    globalThis.Map = class extends nativeMap {
      constructor(...args) {
        super(...args);
        maps++;
      }
    };
    const scrubRun = (baseline) => {
      maps = 0;
      const times = [];
      let checksum = 0;
      for (let i = 0; i < 100; i++) {
        const project = { ...fixture, timeline: { ...fixture.timeline, playhead: i * 10 } };
        const start = performance.now();
        for (const id of ids)
          checksum += baseline
            ? AudioBench.baselineEstimate(project, id, waveforms)
            : (AudioBench.estimatedLevels(project, waveforms)[id] ?? 0);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return {
        totalMs: times.reduce((a, b) => a + b, 0),
        medianMs: times[50],
        p95Ms: times[95],
        maxMs: times[99],
        assetMapBuilds: maps,
        checksum,
      };
    };
    const before = scrubRun(true);
    const after = scrubRun(false);
    globalThis.Map = nativeMap;
    if (Math.abs(before.checksum - after.checksum) > 1e-6)
      throw new Error("Scrub estimate mismatch");
    return {
      cases,
      scrub: {
        assets: 1000,
        tracks: 8,
        clips: 1000,
        frames: 100,
        consumers: ids.length,
        before,
        after,
        scope:
          "100 playhead moves; actual old estimator per 17 UI consumers versus shared estimates; excludes React layout/paint",
      },
      meterFrame: {
        tracks: 8,
        samples: 1000,
        medianMs: frameMs[500],
        p95Ms: frameMs[950],
        maxMs: frameMs[999],
        scope:
          "all worklet message handlers + one actual store publication; excludes React layout/paint",
      },
    };
  });
  if (measurements.cases.some((row) => row.maxError > 1e-4) || measurements.meterFrame.p95Ms > 1)
    throw new Error(JSON.stringify(measurements));
  const json = `${JSON.stringify(measurements, null, 2)}\n`;
  process.stdout.write(json);
  if (process.argv[2]) writeFileSync(process.argv[2], json);
} finally {
  await browser.close();
}
