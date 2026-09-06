import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../model/factory";
import {
  dbToLinear,
  linearToDb,
  resolveTrackRoute,
  routeStereo,
  stereoPanMatrix,
} from "../routing";

const p = createEmptyProject();
const base = p.timeline.tracks[0]!;
describe("shared audio routing", () => {
  it("converts dB and linear amplitudes", () => {
    for (const db of [-60, -6, 0, 12]) expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 10);
    expect(dbToLinear(-6)).toBeCloseTo(0.5011872336, 9);
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });
  it("preserves center stereo and uses equal power for each panned input", () => {
    expect(stereoPanMatrix(0)).toEqual([1, 0, 0, 1]);
    for (const pan of [-1, -0.5, 0, 0.5, 1]) {
      const [ll, lr, rl, rr] = stereoPanMatrix(pan);
      expect(ll * ll + rl * rl).toBeCloseTo(1, 10);
      expect(lr * lr + rr * rr).toBeCloseTo(1, 10);
    }
  });
  it("multiplies clip PCM by track, bus and master, after volume automation", () => {
    const track = { ...base, audio: { gainDb: -6, pan: 1, busId: "bus" } };
    const project = {
      ...p,
      timeline: { ...p.timeline, tracks: [track] },
      audio: { buses: [{ id: "bus", name: "Bus", gainDb: -3 }], master: { gainDb: 2 } },
    };
    const result = routeStereo(
      [Float32Array.of(0.2), Float32Array.of(0.4)],
      resolveTrackRoute(project, track),
    );
    expect(result[0][0]).toBeCloseTo(0, 10);
    expect(result[1][0]).toBeCloseTo(0.6 * dbToLinear(-7), 6);
  });
  it("handles mute, solo, muted bus and missing-bus master fallback", () => {
    const other = { ...base, id: p.timeline.tracks[1]!.id, solo: true };
    const project = { ...p, timeline: { ...p.timeline, tracks: [base, other] } };
    expect(resolveTrackRoute(project, base).trackGain).toBe(0);
    expect(resolveTrackRoute(project, other).trackGain).toBe(1);
    expect(resolveTrackRoute(project, { ...other, muted: true }).trackGain).toBe(0);
    const dangling = { ...base, audio: { busId: "deleted" } };
    expect(resolveTrackRoute(p, dangling)).toMatchObject({
      busId: null,
      busGain: 1,
      masterGain: 1,
    });
    expect(
      resolveTrackRoute(
        {
          ...p,
          audio: {
            buses: [{ id: "deleted", name: "Bus", gainDb: 12, muted: true }],
            master: { gainDb: 0 },
          },
        },
        dangling,
      ).busGain,
    ).toBe(0);
  });
});
