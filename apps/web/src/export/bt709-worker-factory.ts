export const createBt709Worker = (): Worker =>
  new Worker(new URL("./bt709.worker.ts", import.meta.url), { type: "module" });
