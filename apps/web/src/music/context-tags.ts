import type { Project } from "@movie-desk/core";

// Text the project already carries about itself — the cheapest honest
// context signal for preselecting recommendation tags.
export const projectContextText = (project: Project): string => {
  const parts: string[] = [project.name];
  for (const marker of project.timeline.markers ?? []) parts.push(marker.label);
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === "text") parts.push(clip.text);
    }
  }
  return parts.filter(Boolean).join("\n");
};

// Library tags that literally appear in the project text. Substring match,
// case-insensitive; single-character tags are skipped as noise.
export const suggestTagsFromText = (text: string, tags: readonly string[]): string[] => {
  const hay = text.toLowerCase();
  return tags.filter((tag) => {
    const needle = tag.trim().toLowerCase();
    return needle.length >= 2 && hay.includes(needle);
  });
};
