// mp4box prints every QuickTime atom it does not model ("©swr", padding) with
// console.error, and its log level cannot go above "error". Real parse
// failures still reach the file's onError callback; only the console print
// for callbacks-less messages is dropped.

interface Mp4BoxLog {
  setLogLevel: (level: unknown) => void;
  error: (module: string, message: string, isofile?: { onError?: unknown }) => void;
  warn: unknown;
}

let quieted: Mp4BoxLog | null = null;

export const quietMp4BoxLogs = (log: Mp4BoxLog): void => {
  if (quieted === log) return;
  quieted = log;
  try {
    log.setLogLevel(log.error);
  } catch {
    // No level surface in this build; the wrapper below still applies.
  }
  const original = log.error;
  log.error = (module, message, isofile) => {
    if (isofile?.onError) original.call(log, module, message, isofile);
  };
};
