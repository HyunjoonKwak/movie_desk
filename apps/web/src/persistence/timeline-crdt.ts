import {
  type Clip,
  NestedTimelineError,
  type Project,
  type Timeline,
  type Track,
} from "@movie-desk/core";
import type * as Y from "yjs";
import { reconcileSequence, uniqueSequence } from "./crdt-sequence";

type TimelineMeta = Omit<Timeline, "tracks">;
type TrackMeta = Omit<Track, "clips">;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sync = <T>(map: Y.Map<T>, values: ReadonlyMap<string, T>): void => {
  for (const key of [...map.keys()]) if (!values.has(key)) map.delete(key);
  for (const [key, value] of values)
    if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, clone(value));
};

// JSON tuples are unambiguous even when imported IDs contain ':' or quotes.
export const timelineTrackMapName = (timelineId: string): string =>
  `timeline-tracks-v3:${JSON.stringify([timelineId])}`;
export const timelineClipKey = (timelineId: string, clipId: string): string =>
  JSON.stringify([timelineId, clipId]);

export const createTimelineCrdt = (doc: Y.Doc) => {
  const timelinesMap = doc.getMap<TimelineMeta>("timelines-v3");
  const timelineOrder = doc.getArray<string>("timeline-order-v3");
  const clipsMap = doc.getMap<Clip>("clips-v3");
  const tracksFor = (id: string) => doc.getMap<TrackMeta>(timelineTrackMapName(id));
  const trackOrderFor = (id: string) =>
    doc.getArray<string>(`timeline-track-order-v3:${JSON.stringify([id])}`);
  const clipOrderFor = (timelineId: string, trackId: string) =>
    doc.getArray<string>(`timeline-clip-order-v3:${JSON.stringify([timelineId, trackId])}`);

  const write = (project: Project): void => {
    const nextTimelines = new Map<string, TimelineMeta>();
    const nextClips = new Map<string, Clip>();
    for (const timeline of project.timelines) {
      const { tracks, ...meta } = timeline;
      nextTimelines.set(timeline.id, meta);
      const tracksMap = tracksFor(timeline.id);
      const nextTracks = new Map<string, TrackMeta>();
      for (const { clips, ...track } of tracks) {
        nextTracks.set(track.id, track);
        reconcileSequence(
          clipOrderFor(timeline.id, track.id),
          clips.map((clip) => clip.id),
        );
        for (const clip of clips) nextClips.set(timelineClipKey(timeline.id, clip.id), clip);
      }
      for (const trackId of tracksMap.keys())
        if (!nextTracks.has(trackId)) reconcileSequence(clipOrderFor(timeline.id, trackId), []);
      sync(tracksMap, nextTracks);
      reconcileSequence(
        trackOrderFor(timeline.id),
        tracks.map((track) => track.id),
      );
    }
    for (const timelineId of timelinesMap.keys()) {
      if (nextTimelines.has(timelineId)) continue;
      const tracks = tracksFor(timelineId);
      for (const trackId of tracks.keys()) reconcileSequence(clipOrderFor(timelineId, trackId), []);
      sync(tracks, new Map());
      reconcileSequence(trackOrderFor(timelineId), []);
    }
    sync(timelinesMap, nextTimelines);
    reconcileSequence(
      timelineOrder,
      project.timelines.map((timeline) => timeline.id),
    );
    sync(clipsMap, nextClips);
  };

  const read = (rootTimelineId: unknown, localView: Timeline): readonly Timeline[] => {
    const timelineIds = uniqueSequence(timelineOrder.toArray());
    if (!timelineIds.length || timelinesMap.size !== timelineIds.length)
      throw new NestedTimelineError(
        "Missing timeline metadata or timeline order; original document is unchanged",
      );
    const seenClips = new Set<string>();
    const timelines = timelineIds.map((timelineId) => {
      const meta = timelinesMap.get(timelineId);
      if (!meta || meta.id !== timelineId)
        throw new NestedTimelineError(`Missing timeline: ${timelineId}`);
      const tracksMap = tracksFor(timelineId);
      const trackIds = uniqueSequence(trackOrderFor(timelineId).toArray());
      if (tracksMap.size !== trackIds.length)
        throw new NestedTimelineError(`Incomplete track order: ${timelineId}`);
      const tracks = trackIds.map((trackId) => {
        const track = tracksMap.get(trackId);
        if (!track || track.id !== trackId)
          throw new NestedTimelineError(`Missing track: ${trackId}`);
        const clips = uniqueSequence(clipOrderFor(timelineId, trackId).toArray()).map((clipId) => {
          const key = timelineClipKey(timelineId, clipId);
          const clip = clipsMap.get(key);
          if (!clip || clip.id !== clipId || seenClips.has(key))
            throw new NestedTimelineError(`Missing or repeated clip: ${key}`);
          seenClips.add(key);
          return clip;
        });
        return { ...track, clips };
      });
      const duration = tracks.reduce(
        (max, track) =>
          track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), max),
        0,
      );
      return {
        ...meta,
        tracks,
        duration,
        ...(timelineId === rootTimelineId
          ? {
              playhead: localView.playhead,
              zoom: localView.zoom,
            }
          : {}),
      };
    });
    if (seenClips.size !== clipsMap.size)
      throw new NestedTimelineError("Unordered clips in timeline document");
    return timelines;
  };
  return { clips: clipsMap, write, read };
};
