// Barrel re-exporter for the timeline mutate slices. Splitting kept the
// public API stable — every existing `import { addClip, ... } from "@movie-desk/core"`
// keeps resolving to the same symbol thanks to this re-export.
//
//   mutate-core       — track + clip CRUD, move/trim, updateClip/Track,
//                       moveClipToTrack, setPlayhead/setZoom
//   mutate-edit       — ripple/roll/slide/slip, group, freeze/disable,
//                       detachAudio, duplicate, crossfade, closeGaps
//   mutate-effect     — addEffect/removeEffect/setParam/toggle/reorder,
//                       upsertEffect, setAudioFade
//   mutate-transform  — transform/mask/blend mode/transitions
//   mutate-keyframe   — clip-level keyframe ops
//   mutate-marker     — marker ops on the timeline

export * from "./mutate-core";
export * from "./mutate-edit";
export * from "./mutate-effect";
export * from "./mutate-transform";
export * from "./mutate-keyframe";
export * from "./mutate-marker";
