// Runtime boundary around the unchanged v1 codec. Phase 0 must not open the
// persistence schema; Phase 1 + 7 will replace this adapter and the CRDT together.
import {
  hydrateProjectTimelines,
  toLegacyProject,
  type LegacyProject,
  type Project,
} from "@movie-desk/core";
import {
  downloadProjectJson as downloadV1,
  parseProjectExport as parseV1Export,
  parseStoredProject as parseV1Project,
  takeAudioRecovery as takeV1AudioRecovery,
  toProjectExport as exportV1,
  type ProjectExport,
} from "./project-export";

export { ProjectVersionError } from "./project-export";
export type { ProjectExport } from "./project-export";

const recoveredAudio = new WeakSet<Project>();
const hydrate = (parsed: LegacyProject): Project => {
  const project = hydrateProjectTimelines(parsed);
  // The v1 codec's public type predates the runtime-only timeline fields.
  if (takeV1AudioRecovery(parsed as Project)) recoveredAudio.add(project);
  return project;
};
export const takeAudioRecovery = (project: Project): boolean => recoveredAudio.delete(project);

export const parseStoredProject = (raw: unknown): Project => hydrate(parseV1Project(raw));
export const parseProjectExport = (raw: unknown): ProjectExport => {
  const envelope = parseV1Export(raw);
  return { ...envelope, project: hydrate(envelope.project) };
};

export type LegacyProjectExport = Omit<ProjectExport, "project"> & {
  readonly project: LegacyProject;
};

// Narrow assertions isolate the old codec's Project annotation: it only reads
// v1 fields. The runtime collection never reaches JSON, including downloads.
export const toProjectExport = (project: Project): LegacyProjectExport =>
  exportV1(toLegacyProject(project) as Project);
export const downloadProjectJson = (project: Project): void =>
  downloadV1(toLegacyProject(project) as Project);
