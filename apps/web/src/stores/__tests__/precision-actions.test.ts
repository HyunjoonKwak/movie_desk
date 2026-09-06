import { describe, expect, it } from "vitest";
import {
  addClip,
  createEmptyProject,
  findClip,
  newId,
  type MediaClip,
  type ID,
  durationForSourceSpan,
  sourceOffsetForRamp,
} from "@movie-desk/core";
import { useProjectStore } from "../project-store";

const setup = (fps = 30, speed = 1) => {
  const p = { ...createEmptyProject(), framerate: fps };
  const clip: MediaClip = {
    id: newId(),
    kind: "media",
    assetId: newId(),
    start: 1000,
    duration: 4000,
    trimIn: 0,
    trimOut: 4000,
    speed,
    effects: [],
    keyframes: [],
  };
  useProjectStore.getState().loadProject(addClip(p, p.timeline.tracks[0]!.id, clip));
  return clip;
};
const current = (id: ID) => findClip(useProjectStore.getState().project.timeline, id)!;

describe("precision edit commands", () => {
  it("source trim preserves start, recalculates duration at speed and undoes once", () => {
    const clip = setup(30, 2);
    useProjectStore.getState().setSourceTrim(clip.id, "in", 1000);
    expect(current(clip.id)).toMatchObject({
      start: 1000,
      trimIn: 1000,
      trimOut: 4000,
      duration: 1500,
    });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(current(clip.id)).toEqual(clip);
  });
  it("rejects crossing, nonfinite and out-of-source trims without history", () => {
    const clip = setup();
    for (const ms of [0, -1, 5000, Number.NaN, Number.POSITIVE_INFINITY])
      useProjectStore.getState().setSourceTrim(clip.id, "out", ms);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
  it("records exact transform input as one reversible edit", () => {
    const clip = setup();
    useProjectStore.getState().commitTransform(clip.id, { x: 0.125, rotation: 0.1 });
    expect(current(clip.id).transform).toMatchObject({ x: 0.125, rotation: 0.1 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(current(clip.id)).toEqual(clip);
  });
  it.each([23.976, 29.97])("snaps source trim and duration at %s fps", (fps) => {
    const clip = setup(fps);
    useProjectStore.getState().setSourceTrim(clip.id, "out", 1234);
    const next = current(clip.id) as MediaClip;
    expect((next.trimOut * fps) / 1000).toBeCloseTo(Math.round((1234 * fps) / 1000));
    expect((next.duration * fps) / 1000).toBeCloseTo(Math.round((next.duration * fps) / 1000));
  });
  it("inverts ramp source offsets including its constant tail", () => {
    const clip = {
      ...setup(),
      keyframes: [
        {
          target: "speed",
          keyframes: [
            { at: 0, value: 0.5, easing: "linear" as const },
            { at: 503, value: 2, easing: "linear" as const },
          ],
        },
      ],
    };
    for (const time of [0, 3, 250, 503, 510, 3000])
      expect(durationForSourceSpan(clip, sourceOffsetForRamp(clip, time))).toBeCloseTo(time, 6);
  });
});

describe("live precision transactions", () => {
  it.each(["transform", "speed", "slip", "keyframe"] as const)(
    "publishes %s during the gesture and records one undo on release",
    (kind) => {
      const clip = setup();
      const store = useProjectStore.getState();
      const token = store.beginPrecisionEdit();
      const preview = (value: number) =>
        store.previewPrecisionEdit(token, () => {
          if (kind === "transform") store.setTransform(clip.id, { scale: value });
          if (kind === "speed") store.previewClipSpeed(clip.id, value);
          if (kind === "slip") store.previewSlipClipTo(clip.id, value);
          if (kind === "keyframe") store.previewKeyframe(clip.id, "transform.scale", 0, value);
        });
      preview(1.1);
      preview(1.2);
      const after = current(clip.id) as MediaClip;
      if (kind === "transform") expect(after.transform?.scale).toBe(1.2);
      if (kind === "speed") expect(after.speed).toBe(1.2);
      if (kind === "slip") expect(after.trimIn).toBeCloseTo(1.2);
      if (kind === "keyframe") expect(after.keyframes[0]?.keyframes[0]?.value).toBe(1.2);
      expect(useProjectStore.getState().history.past).toHaveLength(0);
      store.endPrecisionEdit(token);
      expect(useProjectStore.getState().history.past).toHaveLength(1);
      store.endPrecisionEdit(token);
      expect(useProjectStore.getState().history.past).toHaveLength(1);
      store.undo();
      expect(current(clip.id)).toEqual(clip);
      store.redo();
      expect(current(clip.id)).toEqual(after);
    },
  );
  it("restores cancelled live edits without consuming undo or changing view state", () => {
    const clip = setup();
    const store = useProjectStore.getState();
    const token = store.beginPrecisionEdit();
    store.previewPrecisionEdit(token, () => store.setTransform(clip.id, { opacity: 0.25 }));
    store.setPlayheadMs(2300);
    store.endPrecisionEdit(token, true);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().project.timeline.playhead).toBe(2300);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
  it("invalidates a gesture when a project is reloaded, including the same project id", () => {
    const clip = setup();
    const store = useProjectStore.getState();
    const original = store.project;
    const token = store.beginPrecisionEdit();
    store.previewPrecisionEdit(token, () => store.previewClipSpeed(clip.id, 2));
    store.loadProject(original);
    store.previewPrecisionEdit(token, () => store.previewClipSpeed(clip.id, 3));
    store.endPrecisionEdit(token, true);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
  it.each([false, true])(
    "rebases across a background command and remains undoable (cancel=%s)",
    (cancel) => {
      const clip = setup();
      const store = useProjectStore.getState();
      const token = store.beginPrecisionEdit("Adjust speed");
      store.previewPrecisionEdit(token, () => store.previewClipSpeed(clip.id, 2));
      store.applyGenerated("Background command", (p) => ({ ...p, name: "Keep this edit" }));
      expect(current(clip.id).speed).toBe(2);
      expect(useProjectStore.getState().history.past.map((c) => c.label)).toEqual([
        "Adjust speed",
        "Background command",
      ]);
      store.previewPrecisionEdit(token, () => store.previewClipSpeed(clip.id, 3));
      expect(current(clip.id).speed).toBe(3);
      store.endPrecisionEdit(token, cancel);
      expect(current(clip.id).speed).toBe(cancel ? 2 : 3);
      expect(useProjectStore.getState().project.name).toBe("Keep this edit");
      if (!cancel) {
        store.undo();
        expect(current(clip.id).speed).toBe(2);
      }
      store.undo();
      expect(current(clip.id).speed).toBe(2);
      expect(useProjectStore.getState().project.name).not.toBe("Keep this edit");
      store.undo();
      expect(current(clip.id)).toEqual(clip);
    },
  );
  it("discards a return-to-origin gesture and releases the persistence gate", () => {
    const clip = setup();
    const store = useProjectStore.getState();
    const token = store.beginPrecisionEdit("Adjust scale");
    store.previewPrecisionEdit(token, () => store.setTransform(clip.id, { scale: 2 }));
    store.previewPrecisionEdit(token, () => store.setTransform(clip.id, { scale: 1 }));
    store.endPrecisionEdit(token, false, true);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
    expect(useProjectStore.getState().precisionEditing).toBe(false);
  });
  it("makes a standalone slip action undoable", () => {
    const clip = setup();
    useProjectStore.getState().slipClipBy(clip.id, 100);
    expect((current(clip.id) as MediaClip).trimIn).toBe(100);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(current(clip.id)).toEqual(clip);
  });
  it("does not source-trim or slip the virtual duration of a still image", () => {
    const clip = setup();
    const p = useProjectStore.getState().project;
    useProjectStore.getState().loadProject({
      ...p,
      mediaLibrary: [
        {
          id: clip.assetId,
          name: "still.png",
          kind: "image",
          mime: "image/png",
          durationMs: 5000,
          opfsPath: "still",
          importedAt: 0,
        },
      ],
    });
    useProjectStore.getState().setSourceTrim(clip.id, "out", 1000);
    useProjectStore.getState().slipClipBy(clip.id, 100);
    expect(current(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
});
