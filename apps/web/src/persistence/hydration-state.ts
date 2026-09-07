import type { Project } from "@movie-desk/core";

// Session-only guards: opening/migrating a row is not an edit.
const restoredProjects = new WeakSet<Project>();
const blockedProjects = new Set<string>();
export const rememberRestoredProject = (project: Project): Project => {
  restoredProjects.add(project);
  return project;
};
export const isRestoredProject = (project: Project): boolean => restoredProjects.has(project);
export const blockProjectWrites = (id: string): void => {
  blockedProjects.add(id);
};
export const allowProjectWrites = (id: string): void => {
  blockedProjects.delete(id);
};
export const projectWritesBlocked = (id: string): boolean => blockedProjects.has(id);

// Maintenance may change object identity while a restored row remains read-only.
const restoredMaintenance = new WeakSet<Project>();
export const inheritRestoredProject = (previous: Project, next: Project): Project => {
  if (isRestoredProject(previous)) {
    rememberRestoredProject(next);
    restoredMaintenance.add(next);
  }
  return next;
};
export const isRestoredMaintenance = (project: Project): boolean =>
  restoredMaintenance.has(project);
