import { assertCanonicalProject } from "../model/project-view";
import { syncRootTimeline } from "../model/project-timelines";
import type { Project } from "../model/project";
import type { AppliedCommand, Command } from "./types";

export interface CommandHistory {
  readonly past: readonly AppliedCommand[];
  readonly future: readonly AppliedCommand[];
}

export const emptyHistory: CommandHistory = { past: [], future: [] };

// Cap on retained undo entries. Each entry holds full before/after project
// snapshots, so unbounded growth becomes the dominant memory cost in long
// sessions. 200 ≈ a typical editing session and is well past the depth most
// users actually traverse.
const MAX_HISTORY = 200;

export interface RunResult {
  readonly project: Project;
  readonly history: CommandHistory;
  readonly applied: AppliedCommand;
}

export const runCommand = (
  project: Project,
  history: CommandHistory,
  command: Command,
): RunResult => {
  assertCanonicalProject(project);
  const after = syncRootTimeline(command.apply(project));
  assertCanonicalProject(after);
  const applied: AppliedCommand = {
    label: command.label,
    before: project,
    after,
    at: Date.now(),
  };
  const nextPast = [...history.past, applied];
  // Drop the oldest entries once we exceed the cap; the user keeps the most
  // recent MAX_HISTORY undo steps.
  const trimmed = nextPast.length > MAX_HISTORY ? nextPast.slice(-MAX_HISTORY) : nextPast;
  return {
    project: after,
    history: { past: trimmed, future: [] },
    applied,
  };
};

// Record an edit that was already applied transiently (e.g. a drag gesture
// committed once on pointer-up) as a single undo step.
export const recordApplied = (
  before: Project,
  after: Project,
  history: CommandHistory,
  label: string,
): CommandHistory => {
  assertCanonicalProject(before);
  assertCanonicalProject(after);
  const applied: AppliedCommand = { label, before, after, at: Date.now() };
  const nextPast = [...history.past, applied];
  const trimmed = nextPast.length > MAX_HISTORY ? nextPast.slice(-MAX_HISTORY) : nextPast;
  return { past: trimmed, future: [] };
};

export interface StepResult {
  readonly project: Project;
  readonly history: CommandHistory;
}

export const undo = (project: Project, history: CommandHistory): StepResult => {
  const last = history.past.at(-1);
  if (!last) return { project, history };
  return {
    project: last.before,
    history: {
      past: history.past.slice(0, -1),
      future: [last, ...history.future],
    },
  };
};

export const redo = (project: Project, history: CommandHistory): StepResult => {
  const next = history.future[0];
  if (!next) return { project, history };
  return {
    project: next.after,
    history: {
      past: [...history.past, next],
      future: history.future.slice(1),
    },
  };
};
