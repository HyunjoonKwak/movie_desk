import { type Project, listCuts } from "@movie-desk/core";

// Letters and digits in any script survive; everything else collapses to an
// underscore. macOS is happy with Korean file names and so is Finder search.
export const sanitizeName = (s: string): string =>
  s
    .replace(/[^\p{L}\p{N}_\-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// The file is named for what was exported: the cut when it has a name, the
// project when it is the only cut, and "project N" for an unnamed extra cut.
export const exportBaseName = (project: Project): string => {
  const cut = project.timeline;
  if (cut.name) return cut.name;
  const cuts = listCuts(project);
  if (cuts.length < 2) return project.name;
  return `${project.name} ${cuts.findIndex((c) => c.id === cut.id) + 1}`;
};
