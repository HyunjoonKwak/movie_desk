import { type Project, toLegacyProject } from "@movie-desk/core";
import * as Y from "yjs";

// Frozen schema-2 writer, independent of the implementation under test.
// New writers cannot accidentally make the migration test seed schema 3.
export const legacyCrdt = (project: Project): Y.Doc => {
  const doc = new Y.Doc();
  const raw = toLegacyProject(project);
  doc.transact(() => {
    const meta = doc.getMap("project-meta");
    for (const [key, value] of Object.entries({
      schemaVersion: 2,
      name: raw.name,
      createdAt: raw.createdAt,
      framerate: raw.framerate,
      resolution: raw.resolution,
      magnetic: true,
      markers: raw.timeline.markers ?? [],
      ...(raw.audio ? { audio: raw.audio } : {}),
    }))
      meta.set(key, value);
    doc.getArray("track-order-v2").push(raw.timeline.tracks.map((track) => track.id));
    for (const { clips, ...track } of raw.timeline.tracks) {
      doc.getMap("tracks-v2").set(track.id, track);
      doc.getArray(`track-clips-v2:${track.id}`).push(clips.map((clip) => clip.id));
      for (const clip of clips) doc.getMap("clips").set(clip.id, clip);
    }
    doc.getArray("media-order-v2").push(raw.mediaLibrary.map((asset) => asset.id));
    for (const asset of raw.mediaLibrary) doc.getMap("media-v2").set(asset.id, asset);
    doc.getArray("collection-order-v1").push((raw.collections ?? []).map((item) => item.id));
    for (const item of raw.collections ?? []) doc.getMap("collections-v1").set(item.id, item);
  });
  return doc;
};
