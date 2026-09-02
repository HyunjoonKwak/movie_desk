import { useProjectStore } from "@/stores/project-store";
import type { ID, MediaAsset } from "@movie-desk/core";
import { Compositor } from "./compositor";

interface BenchResult {
  readonly frames: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly fps: number;
}

// Renders the current project at the project's native resolution `frames`
// times, stepping the virtual playhead across the full duration. Reports
// the average + percentile frame time and an effective FPS.
//
// Run from the DevTools console:
//   await window.__cutBench(120)
const runRenderBench = async (frames = 60): Promise<BenchResult> => {
  const project = useProjectStore.getState().project;
  const assets = new Map(project.mediaLibrary.map((a) => [a.id, a]));
  const getAsset = (id: ID): MediaAsset | undefined => assets.get(id);
  const { w, h } = project.resolution;
  const dur = Math.max(1, project.timeline.duration);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = new Compositor(canvas);
  try {
    c.resize(w, h);
    let virtual = 0;
    c.setPlayheadGetter(() => virtual);
    // Warm-up pass — compiles + uploads aren't paid in steady-state.
    await c.renderFrame({ ...project, timeline: { ...project.timeline, playhead: 0 } }, getAsset);

    const samples: number[] = [];
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      virtual = (i / Math.max(1, frames - 1)) * dur;
      const p = { ...project, timeline: { ...project.timeline, playhead: virtual } };
      const f0 = performance.now();
      await c.renderFrame(p, getAsset);
      samples.push(performance.now() - f0);
    }
    const totalMs = performance.now() - t0;
    samples.sort((a, b) => a - b);
    const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))]!;
    const avgMs = totalMs / frames;
    return {
      frames,
      totalMs,
      avgMs,
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      fps: 1000 / avgMs,
    };
  } finally {
    c.dispose();
  }
};

// Dev-only console hook. Mirrors `__cutStore`.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __cutBench?: typeof runRenderBench }).__cutBench = runRenderBench;
}
