import type { BlendMode } from "@movie-desk/core";

// Presentation grouping for the blend-mode picker. Seventeen modes in one flat
// list is unreadable, so they are bucketed the way every other editor buckets
// them: by what the mode does to the image. Kept in its own module (rather than
// inline in the inspector) so a test can assert the groups stay in sync with
// BLEND_MODES — a mode missing from here would silently vanish from the UI.
export interface BlendGroup {
  readonly labelKey: string;
  readonly modes: readonly BlendMode[];
}

export const BLEND_GROUPS: readonly BlendGroup[] = [
  { labelKey: "blend.group.normal", modes: ["normal"] },
  { labelKey: "blend.group.darken", modes: ["multiply", "darken", "color-burn"] },
  { labelKey: "blend.group.lighten", modes: ["screen", "add", "lighten", "color-dodge"] },
  { labelKey: "blend.group.contrast", modes: ["overlay", "soft-light", "hard-light"] },
  { labelKey: "blend.group.comparative", modes: ["difference", "exclusion"] },
  { labelKey: "blend.group.component", modes: ["hue", "saturation", "color", "luminosity"] },
];
