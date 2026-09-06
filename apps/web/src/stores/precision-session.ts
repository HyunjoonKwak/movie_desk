import { recordApplied, type CommandHistory, type Project } from "@movie-desk/core";

export const precisionSession: {
  current: {
    token: symbol;
    before: Project;
    history: CommandHistory;
    label: string;
    rebased: boolean;
  } | null;
} = { current: null };

// A real command checkpoints the live gesture before it records its own edit.
// Resume the same token after that command so continued dragging/Escape remain valid.
export const checkpointPrecision = (project: Project, history: CommandHistory): CommandHistory => {
  const session = precisionSession.current;
  if (!session || session.before.id !== project.id || session.history !== history) return history;
  return project === session.before
    ? history
    : recordApplied(session.before, project, history, session.label);
};

export const resumePrecision = (project: Project, history: CommandHistory): void => {
  const session = precisionSession.current;
  if (!session || session.before.id !== project.id) return;
  session.before = project;
  session.history = history;
  session.rebased = true;
};
