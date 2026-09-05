import { describe, expect, it } from "vitest";
import type { MediaClip } from "../../model/clip";
import { createEmptyProject } from "../../model/factory";
import { newId } from "../../utils/id";
import {
  addClip,
  closeGapsOnTrack,
  detachAudio,
  groupClips,
  moveClip,
  moveClipOrGroup,
  removeClip,
  removeEffectFromClip,
  reorderEffect,
  rippleDeleteClip,
  rollEdit,
  slideClip,
  toggleEffectEnabled,
  trimClipEnd,
  trimClipStart,
  ungroupClips,
} from "../mutate";
import { computeDuration, findClip } from "../query";
import { splitClipAt } from "../split";

const makeMediaClip = (start = 0, duration = 1000): MediaClip => ({
  kind: "media",
  id: newId(),
  assetId: newId(),
  start,
  duration,
  trimIn: 0,
  trimOut: duration,
  speed: 1,
  effects: [],
  keyframes: [],
});

describe("timeline mutate", () => {
  it("adds a clip and recomputes duration", () => {
    const p0 = createEmptyProject();
    const videoTrackId = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(0, 2000);

    const p1 = addClip(p0, videoTrackId, clip);

    expect(p1.timeline.tracks[0]!.clips).toHaveLength(1);
    expect(computeDuration(p1.timeline)).toBe(2000);
  });

  it("moves a clip immutably", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(0, 1000);
    const p1 = addClip(p0, tid, clip);

    const p2 = moveClip(p1, clip.id, 500);

    expect(findClip(p2.timeline, clip.id)!.start).toBe(500);
    // original untouched
    expect(findClip(p1.timeline, clip.id)!.start).toBe(0);
  });

  it("splits a clip at the playhead", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(0, 2000);
    const p1 = addClip(p0, tid, clip);

    const p2 = splitClipAt(p1, clip.id, 1000);

    const clips = p2.timeline.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.duration).toBe(1000);
    expect(clips[1]!.start).toBe(1000);
  });

  it("removes a clip", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip();
    const p1 = addClip(p0, tid, clip);

    const p2 = removeClip(p1, clip.id);

    expect(p2.timeline.tracks[0]!.clips).toHaveLength(0);
  });

  it("ripple-deletes a clip and pulls later clips back", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const a = makeMediaClip(0, 1000);
    const b = makeMediaClip(1000, 1000); // butts against a
    const c = makeMediaClip(2000, 1000);
    let p = addClip(p0, tid, a);
    p = addClip(p, tid, b);
    p = addClip(p, tid, c);

    const after = rippleDeleteClip(p, b.id);
    const clips = after.timeline.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    // a stays at 0; c shifts back by b's duration (1000) to 1000.
    expect(findClip(after.timeline, a.id)!.start).toBe(0);
    expect(findClip(after.timeline, c.id)!.start).toBe(1000);
  });

  it("closes gaps on a track, compacting from the first clip", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const a = makeMediaClip(0, 1000);
    const b = makeMediaClip(3000, 1000); // gap from 1000..3000
    let p = addClip(p0, tid, a);
    p = addClip(p, tid, b);

    const after = closeGapsOnTrack(p, tid);
    expect(findClip(after.timeline, a.id)!.start).toBe(0);
    expect(findClip(after.timeline, b.id)!.start).toBe(1000); // butts against a
  });

  it("roll-edits the cut between two adjacent clips", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const a = makeMediaClip(0, 1000);
    const b = { ...makeMediaClip(1000, 1000), trimIn: 1000, trimOut: 2000 };
    let p = addClip(p0, tid, a);
    p = addClip(p, tid, b);

    const after = rollEdit(p, a.id, 200);
    const ca = findClip(after.timeline, a.id)!;
    const cb = findClip(after.timeline, b.id)! as typeof b;
    expect(ca.duration).toBe(1200); // a extended
    expect(cb.start).toBe(1200); // b cut moved later, stays butted
    expect(cb.duration).toBe(800);
    expect(cb.trimIn).toBe(1200); // source in-point followed
  });

  it("slide-edits a clip between its neighbours", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const a = makeMediaClip(0, 1000);
    const b = makeMediaClip(1000, 1000);
    const c = { ...makeMediaClip(2000, 1000), trimIn: 0, trimOut: 1000 };
    let p = addClip(p0, tid, a);
    p = addClip(p, tid, b);
    p = addClip(p, tid, c);

    const after = slideClip(p, b.id, 300);
    expect(findClip(after.timeline, a.id)!.duration).toBe(1300); // prev extended
    expect(findClip(after.timeline, b.id)!.start).toBe(1300); // b moved, same duration
    expect(findClip(after.timeline, b.id)!.duration).toBe(1000);
    expect(findClip(after.timeline, c.id)!.start).toBe(2300); // next shifted
    expect(findClip(after.timeline, c.id)!.duration).toBe(700);
  });

  it("detaches audio to a new audio track and mutes the source", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(0, 2000);
    const p1 = addClip(p0, tid, clip);

    const after = detachAudio(p1, clip.id);
    const audioTrack = after.timeline.tracks.find((t) => t.kind === "audio");
    expect(audioTrack).toBeTruthy();
    expect(audioTrack!.clips).toHaveLength(1);
    const detached = audioTrack!.clips[0]!;
    expect(detached.kind).toBe("media");
    expect(detached.start).toBe(0);
    expect(detached.duration).toBe(2000);
    // original video clip's audio is muted
    const orig = findClip(after.timeline, clip.id)! as typeof clip;
    expect(orig.volume).toBe(0);
  });

  it("moves grouped clips together", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const a = makeMediaClip(0, 1000);
    const b = makeMediaClip(2000, 1000);
    let p = addClip(p0, tid, a);
    p = addClip(p, tid, b);
    p = groupClips(p, [a.id, b.id]);

    const after = moveClipOrGroup(p, a.id, 500);
    expect(findClip(after.timeline, a.id)!.start).toBe(500);
    expect(findClip(after.timeline, b.id)!.start).toBe(2500); // moved with the group

    const ungrouped = ungroupClips(after, a.id);
    const moved = moveClipOrGroup(ungrouped, a.id, 500);
    expect(findClip(moved.timeline, a.id)!.start).toBe(1000);
    expect(findClip(moved.timeline, b.id)!.start).toBe(2500); // b stays put
  });

  it("trims clip end", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(0, 2000);
    const p1 = addClip(p0, tid, clip);

    const p2 = trimClipEnd(p1, clip.id, 1500);

    expect(findClip(p2.timeline, clip.id)!.duration).toBe(1500);
  });

  it("trims clip start and preserves end", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const clip = makeMediaClip(500, 2000); // ends at 2500
    const p1 = addClip(p0, tid, clip);

    const p2 = trimClipStart(p1, clip.id, 1000);

    const trimmed = findClip(p2.timeline, clip.id)!;
    expect(trimmed.start).toBe(1000);
    expect(trimmed.duration).toBe(1500); // 2500 - 1000
  });

  it("keeps project identity for missing effects and same-position reorders", () => {
    const p0 = createEmptyProject();
    const tid = p0.timeline.tracks[0]!.id;
    const effectId = newId();
    const clip = {
      ...makeMediaClip(),
      effects: [{ id: effectId, type: "blur", enabled: true, params: {} }],
    };
    const project = addClip(p0, tid, clip);
    const missing = newId();

    expect(removeEffectFromClip(project, clip.id, missing)).toBe(project);
    expect(toggleEffectEnabled(project, clip.id, missing)).toBe(project);
    expect(reorderEffect(project, clip.id, missing, 0)).toBe(project);
    expect(reorderEffect(project, clip.id, effectId, 0)).toBe(project);
  });
});
