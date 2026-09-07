import { syncRootTimeline } from "../model/project-timelines";
import type { Project } from "../model/project";
import type { TrackAudio } from "../model/track";

export type MixerEdit =
  | { readonly kind: "track"; readonly id: string; readonly patch: TrackAudio }
  | { readonly kind: "master"; readonly gainDb: number }
  | { readonly kind: "bus-add"; readonly id: string; readonly name: string }
  | { readonly kind: "bus-delete"; readonly id: string }
  | {
      readonly kind: "bus";
      readonly id: string;
      readonly gainDb?: number;
      readonly name?: string;
      readonly muted?: boolean;
    };

const validGain = (gain: number | undefined) =>
  gain === undefined || (Number.isFinite(gain) && gain >= -60 && gain <= 12);

// Phase 0 deliberately edits only root tracks (including bus-delete cleanup).
// Phase 5 must scope track edits and clear deleted bus refs across all timelines.
export const editMixer = (project: Project, edit: MixerEdit): Project => {
  const audio = project.audio ?? { buses: [], master: { gainDb: 0 } };
  if (edit.kind === "track") {
    const { pan, gainDb } = edit.patch;
    if (!validGain(gainDb) || (pan !== undefined && (!Number.isFinite(pan) || Math.abs(pan) > 1)))
      return project;
    const tracks = project.timeline.tracks.map((track) => {
      if (track.id !== edit.id) return track;
      const merged = { ...track.audio, ...edit.patch };
      const { busId, ...rest } = merged;
      const next = busId === "" ? rest : merged;
      if (JSON.stringify(next) === JSON.stringify(track.audio)) return track;
      return { ...track, audio: next };
    });
    if (tracks.every((track, i) => track === project.timeline.tracks[i])) return project;
    return syncRootTimeline({ ...project, timeline: { ...project.timeline, tracks } });
  }
  if (edit.kind === "master") {
    if (!validGain(edit.gainDb) || audio.master.gainDb === edit.gainDb) return project;
    return { ...project, audio: { ...audio, master: { gainDb: edit.gainDb } } };
  }
  if (edit.kind === "bus-add") {
    if (
      !edit.id ||
      !edit.name.trim() ||
      edit.name.length > 100 ||
      audio.buses.some((bus) => bus.id === edit.id)
    )
      return project;
    return {
      ...project,
      audio: {
        ...audio,
        buses: [...audio.buses, { id: edit.id, name: edit.name.trim(), gainDb: 0 }],
      },
    };
  }
  if (!audio.buses.some((bus) => bus.id === edit.id)) return project;
  if (edit.kind === "bus-delete") {
    return syncRootTimeline({
      ...project,
      audio: { ...audio, buses: audio.buses.filter((bus) => bus.id !== edit.id) },
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) => {
          if (track.audio?.busId !== edit.id) return track;
          const { busId: _removed, ...rest } = track.audio;
          return { ...track, audio: rest };
        }),
      },
    });
  }
  if (
    !validGain(edit.gainDb) ||
    (edit.name !== undefined && (!edit.name.trim() || edit.name.length > 100))
  )
    return project;
  const buses = audio.buses.map((bus) => {
    if (bus.id !== edit.id) return bus;
    const next = {
      ...bus,
      ...(edit.gainDb === undefined ? {} : { gainDb: edit.gainDb }),
      ...(edit.name === undefined ? {} : { name: edit.name.trim() }),
      ...(edit.muted === undefined ? {} : { muted: edit.muted }),
    };
    return JSON.stringify(next) === JSON.stringify(bus) ? bus : next;
  });
  return buses.every((bus, i) => bus === audio.buses[i])
    ? project
    : { ...project, audio: { ...audio, buses } };
};
